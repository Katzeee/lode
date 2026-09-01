package com.lode.mobile

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import java.util.UUID

@ReactModule(name = LodeDatabaseModule.NAME)
class LodeDatabaseModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
  private val databaseHelper = LodeDatabaseHelper(context)
  private val databaseLock = Any()

  override fun getName(): String = NAME

  @ReactMethod
  fun readIdentityBlob(kind: String, promise: Promise) = databaseCall(promise, "IDENTITY_READ_FAILED") {
    requireIdentityKind(kind)
    readableDatabase()
        .query(
            IDENTITY_TABLE,
            arrayOf(BYTES_COLUMN),
            "$KIND_COLUMN = ?",
            arrayOf(kind),
            null,
            null,
            null,
        )
        .use { cursor -> if (cursor.moveToFirst()) cursor.getBlob(0).toWritableArray() else null }
  }

  @ReactMethod
  fun writeIdentityBlob(kind: String, bytes: ReadableArray, promise: Promise) =
      databaseCall(promise, "IDENTITY_WRITE_FAILED") {
        requireIdentityKind(kind)
        val stored =
            writableDatabase()
                .insertWithOnConflict(
                    IDENTITY_TABLE,
                    null,
                    ContentValues().apply {
                      put(KIND_COLUMN, kind)
                      put(BYTES_COLUMN, bytes.toByteArray())
                    },
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
        check(stored != -1L) { "SQLite rejected the $kind identity blob" }
        null
      }

  @ReactMethod
  fun listWorkspaceIds(promise: Promise) = databaseCall(promise, "WORKSPACE_LIST_FAILED") {
    Arguments.createArray().also { result ->
      readableDatabase()
          .query(
              WORKSPACE_TABLE,
              arrayOf(WORKSPACE_ID_COLUMN),
              "$STATE_COLUMN = ?",
              arrayOf(ACTIVE_STATE),
              null,
              null,
              WORKSPACE_ID_COLUMN,
          )
          .use { cursor -> while (cursor.moveToNext()) result.pushString(cursor.getString(0)) }
    }
  }

  @ReactMethod
  fun openWorkspace(workspaceId: String, promise: Promise) = databaseCall(promise, "WORKSPACE_OPEN_FAILED") {
    requireWorkspaceId(workspaceId)
    workspaceStorageId(readableDatabase(), workspaceId, ACTIVE_STATE)
        ?: error("Workspace storage does not exist: $workspaceId")
  }

  @ReactMethod
  fun stageWorkspace(workspaceId: String, promise: Promise) = databaseCall(promise, "WORKSPACE_STAGE_FAILED") {
    requireWorkspaceId(workspaceId)
    transaction(writableDatabase()) { database ->
      check(workspaceStates(database, workspaceId) == 0) { "Workspace storage already exists: $workspaceId" }
      val storageId = UUID.randomUUID().toString()
      val inserted =
          database.insertOrThrow(
              WORKSPACE_TABLE,
              null,
              ContentValues().apply {
                put(STORAGE_ID_COLUMN, storageId)
                put(WORKSPACE_ID_COLUMN, workspaceId)
                put(STATE_COLUMN, STAGED_STATE)
              },
          )
      check(inserted != -1L) { "SQLite rejected Workspace staging" }
      storageId
    }
  }

  @ReactMethod
  fun promoteWorkspace(storageId: String, promise: Promise) =
      databaseCall(promise, "WORKSPACE_PROMOTE_FAILED") {
        requireStorageId(storageId)
        transaction(writableDatabase()) { database ->
          val workspaceId = workspaceId(database, storageId, STAGED_STATE)
              ?: error("Staged Workspace storage does not exist: $storageId")
          check(workspaceStorageId(database, workspaceId, ACTIVE_STATE) == null) {
            "Workspace storage already exists: $workspaceId"
          }
          val changed =
              database.update(
                  WORKSPACE_TABLE,
                  ContentValues().apply { put(STATE_COLUMN, ACTIVE_STATE) },
                  "$STORAGE_ID_COLUMN = ? AND $STATE_COLUMN = ?",
                  arrayOf(storageId, STAGED_STATE),
              )
          check(changed == 1) { "Workspace promotion changed $changed rows" }
        }
        null
      }

  @ReactMethod
  fun deleteWorkspaceStorage(storageId: String, promise: Promise) =
      databaseCall(promise, "WORKSPACE_DELETE_FAILED") {
        requireStorageId(storageId)
        writableDatabase().delete(WORKSPACE_TABLE, "$STORAGE_ID_COLUMN = ?", arrayOf(storageId))
        null
      }

  @ReactMethod
  fun discardStagedWorkspaces(promise: Promise) = databaseCall(promise, "WORKSPACE_DISCARD_FAILED") {
    writableDatabase().delete(WORKSPACE_TABLE, "$STATE_COLUMN = ?", arrayOf(STAGED_STATE))
    null
  }

  @ReactMethod
  fun loadDocument(storageId: String, documentId: String, promise: Promise) =
      databaseCall(promise, "DOCUMENT_LOAD_FAILED") {
        requireStorageId(storageId)
        requireDocumentId(documentId)
        val database = readableDatabase()
        requireWorkspaceStorage(database, storageId)
        var coveredSequence = 0
        var snapshot: ByteArray? = null
        database
            .query(
                SNAPSHOT_TABLE,
                arrayOf(COVERED_SEQUENCE_COLUMN, BYTES_COLUMN),
                "$STORAGE_ID_COLUMN = ? AND $DOCUMENT_ID_COLUMN = ?",
                arrayOf(storageId, documentId),
                null,
                null,
                null,
            )
            .use { cursor ->
              if (cursor.moveToFirst()) {
                coveredSequence = cursor.getInt(0)
                snapshot = cursor.getBlob(1)
              }
            }
        val updates = Arguments.createArray()
        database
            .query(
                UPDATE_TABLE,
                arrayOf(BYTES_COLUMN),
                "$STORAGE_ID_COLUMN = ? AND $DOCUMENT_ID_COLUMN = ? AND $SEQUENCE_COLUMN > ?",
                arrayOf(storageId, documentId, coveredSequence.toString()),
                null,
                null,
                "$SEQUENCE_COLUMN ASC",
            )
            .use { cursor -> while (cursor.moveToNext()) updates.pushArray(cursor.getBlob(0).toWritableArray()) }
        if (snapshot == null && updates.size() == 0) {
          null
        } else {
          Arguments.createMap().apply {
            snapshot?.let { putArray("snapshot", it.toWritableArray()) } ?: putNull("snapshot")
            putArray("updates", updates)
          }
        }
      }

  @ReactMethod
  fun appendDocumentUpdates(storageId: String, updates: ReadableArray, promise: Promise) =
      databaseCall(promise, "DOCUMENT_APPEND_FAILED") {
        requireStorageId(storageId)
        transaction(writableDatabase()) { database ->
          requireWorkspaceStorage(database, storageId)
          val nextByDocument = mutableMapOf<String, Int>()
          Arguments.createArray().also { sequences ->
            for (index in 0 until updates.size()) {
              val update = updates.getMap(index) ?: error("Document update $index is not an object")
              val documentId = update.getString("id") ?: error("Document update $index has no id")
              val bytes = update.getArray("bytes") ?: error("Document update $index has no bytes")
              requireDocumentId(documentId)
              val sequence = nextByDocument[documentId] ?: latestSequence(database, storageId, documentId) + 1
              database.insertOrThrow(
                  UPDATE_TABLE,
                  null,
                  ContentValues().apply {
                    put(STORAGE_ID_COLUMN, storageId)
                    put(DOCUMENT_ID_COLUMN, documentId)
                    put(SEQUENCE_COLUMN, sequence)
                    put(BYTES_COLUMN, bytes.toByteArray())
                  },
              )
              nextByDocument[documentId] = sequence + 1
              sequences.pushInt(sequence)
            }
          }
        }
      }

  @ReactMethod
  fun writeDocumentSnapshot(storageId: String, documentId: String, bytes: ReadableArray, promise: Promise) =
      databaseCall(promise, "DOCUMENT_SNAPSHOT_FAILED") {
        requireStorageId(storageId)
        requireDocumentId(documentId)
        transaction(writableDatabase()) { database ->
          requireWorkspaceStorage(database, storageId)
          val coveredSequence = latestSequence(database, storageId, documentId)
          database.insertWithOnConflict(
              SNAPSHOT_TABLE,
              null,
              ContentValues().apply {
                put(STORAGE_ID_COLUMN, storageId)
                put(DOCUMENT_ID_COLUMN, documentId)
                put(COVERED_SEQUENCE_COLUMN, coveredSequence)
                put(BYTES_COLUMN, bytes.toByteArray())
              },
              SQLiteDatabase.CONFLICT_REPLACE,
          )
          database.delete(
              UPDATE_TABLE,
              "$STORAGE_ID_COLUMN = ? AND $DOCUMENT_ID_COLUMN = ? AND $SEQUENCE_COLUMN <= ?",
              arrayOf(storageId, documentId, coveredSequence.toString()),
          )
        }
        null
      }

  override fun invalidate() {
    synchronized(databaseLock) { databaseHelper.close() }
    super.invalidate()
  }

  private fun readableDatabase(): SQLiteDatabase = databaseHelper.readableDatabase

  private fun writableDatabase(): SQLiteDatabase = databaseHelper.writableDatabase

  private fun <T> databaseCall(promise: Promise, code: String, operation: () -> T) {
    try {
      promise.resolve(synchronized(databaseLock) { operation() })
    } catch (error: Throwable) {
      promise.reject(code, error.message, error)
    }
  }

  private fun <T> transaction(database: SQLiteDatabase, operation: (SQLiteDatabase) -> T): T {
    database.beginTransaction()
    try {
      val result = operation(database)
      database.setTransactionSuccessful()
      return result
    } finally {
      database.endTransaction()
    }
  }

  private fun workspaceStates(database: SQLiteDatabase, workspaceId: String): Int =
      database
          .rawQuery(
              "SELECT COUNT(*) FROM $WORKSPACE_TABLE WHERE $WORKSPACE_ID_COLUMN = ?",
              arrayOf(workspaceId),
          )
          .use { cursor -> check(cursor.moveToFirst()); cursor.getInt(0) }

  private fun workspaceStorageId(database: SQLiteDatabase, workspaceId: String, state: String): String? =
      database
          .query(
              WORKSPACE_TABLE,
              arrayOf(STORAGE_ID_COLUMN),
              "$WORKSPACE_ID_COLUMN = ? AND $STATE_COLUMN = ?",
              arrayOf(workspaceId, state),
              null,
              null,
              null,
          )
          .use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

  private fun workspaceId(database: SQLiteDatabase, storageId: String, state: String): String? =
      database
          .query(
              WORKSPACE_TABLE,
              arrayOf(WORKSPACE_ID_COLUMN),
              "$STORAGE_ID_COLUMN = ? AND $STATE_COLUMN = ?",
              arrayOf(storageId, state),
              null,
              null,
              null,
          )
          .use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

  private fun requireWorkspaceStorage(database: SQLiteDatabase, storageId: String) {
    val count =
        database
            .rawQuery(
                "SELECT COUNT(*) FROM $WORKSPACE_TABLE WHERE $STORAGE_ID_COLUMN = ?",
                arrayOf(storageId),
            )
            .use { cursor -> check(cursor.moveToFirst()); cursor.getInt(0) }
    check(count == 1) { "Workspace storage does not exist: $storageId" }
  }

  private fun latestSequence(database: SQLiteDatabase, storageId: String, documentId: String): Int =
      database
          .rawQuery(
              """
              SELECT COALESCE(MAX(sequence_value), 0)
              FROM (
                SELECT $SEQUENCE_COLUMN AS sequence_value
                FROM $UPDATE_TABLE
                WHERE $STORAGE_ID_COLUMN = ? AND $DOCUMENT_ID_COLUMN = ?
                UNION ALL
                SELECT $COVERED_SEQUENCE_COLUMN AS sequence_value
                FROM $SNAPSHOT_TABLE
                WHERE $STORAGE_ID_COLUMN = ? AND $DOCUMENT_ID_COLUMN = ?
              )
              """.trimIndent(),
              arrayOf(storageId, documentId, storageId, documentId),
          )
          .use { cursor -> check(cursor.moveToFirst()); cursor.getInt(0) }

  private fun requireIdentityKind(kind: String) {
    require(kind == PEER_KIND || kind == VAULT_KIND) { "Unsupported identity blob kind: $kind" }
  }

  private fun requireWorkspaceId(workspaceId: String) {
    require(workspaceId.isNotBlank() && workspaceId.length <= 512) { "Invalid Workspace identity" }
  }

  private fun requireStorageId(storageId: String) {
    require(UUID_PATTERN.matches(storageId)) { "Invalid Workspace storage identity" }
  }

  private fun requireDocumentId(documentId: String) {
    require(documentId.isNotBlank() && documentId.length <= 1024) { "Invalid document identity" }
  }

  private fun ReadableArray.toByteArray(): ByteArray =
      ByteArray(size()) { index ->
        val value = getDouble(index)
        require(value.isFinite() && value % 1.0 == 0.0 && value in 0.0..255.0) {
          "Byte at index $index is invalid: $value"
        }
        value.toInt().toByte()
      }

  private fun ByteArray.toWritableArray() =
      Arguments.createArray().also { array -> forEach { byte -> array.pushInt(byte.toInt() and 0xff) } }

  companion object {
    const val NAME = "LodeDatabase"

    private const val DATABASE_NAME = "lode.db"
    private const val DATABASE_VERSION = 1
    private const val IDENTITY_TABLE = "identity_blobs"
    private const val WORKSPACE_TABLE = "workspace_storage"
    private const val SNAPSHOT_TABLE = "document_snapshots"
    private const val UPDATE_TABLE = "document_updates"
    private const val KIND_COLUMN = "kind"
    private const val STORAGE_ID_COLUMN = "storage_id"
    private const val WORKSPACE_ID_COLUMN = "workspace_id"
    private const val STATE_COLUMN = "state"
    private const val DOCUMENT_ID_COLUMN = "document_id"
    private const val SEQUENCE_COLUMN = "sequence"
    private const val COVERED_SEQUENCE_COLUMN = "covered_sequence"
    private const val BYTES_COLUMN = "bytes"
    private const val ACTIVE_STATE = "active"
    private const val STAGED_STATE = "staged"
    private const val PEER_KIND = "peer"
    private const val VAULT_KIND = "vault"
    private val UUID_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
  }

  private class LodeDatabaseHelper(context: Context) :
      SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {
    init {
      setWriteAheadLoggingEnabled(true)
    }

    override fun onConfigure(database: SQLiteDatabase) {
      super.onConfigure(database)
      database.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(database: SQLiteDatabase) {
      database.execSQL(
          """
          CREATE TABLE $IDENTITY_TABLE (
            $KIND_COLUMN TEXT PRIMARY KEY CHECK ($KIND_COLUMN IN ('$PEER_KIND', '$VAULT_KIND')),
            $BYTES_COLUMN BLOB NOT NULL
          )
          """.trimIndent()
      )
      database.execSQL(
          """
          CREATE TABLE $WORKSPACE_TABLE (
            $STORAGE_ID_COLUMN TEXT PRIMARY KEY,
            $WORKSPACE_ID_COLUMN TEXT NOT NULL,
            $STATE_COLUMN TEXT NOT NULL CHECK ($STATE_COLUMN IN ('$ACTIVE_STATE', '$STAGED_STATE')),
            UNIQUE ($WORKSPACE_ID_COLUMN, $STATE_COLUMN)
          )
          """.trimIndent()
      )
      database.execSQL(
          """
          CREATE TABLE $SNAPSHOT_TABLE (
            $STORAGE_ID_COLUMN TEXT NOT NULL,
            $DOCUMENT_ID_COLUMN TEXT NOT NULL,
            $COVERED_SEQUENCE_COLUMN INTEGER NOT NULL,
            $BYTES_COLUMN BLOB NOT NULL,
            PRIMARY KEY ($STORAGE_ID_COLUMN, $DOCUMENT_ID_COLUMN),
            FOREIGN KEY ($STORAGE_ID_COLUMN) REFERENCES $WORKSPACE_TABLE($STORAGE_ID_COLUMN) ON DELETE CASCADE
          )
          """.trimIndent()
      )
      database.execSQL(
          """
          CREATE TABLE $UPDATE_TABLE (
            $STORAGE_ID_COLUMN TEXT NOT NULL,
            $DOCUMENT_ID_COLUMN TEXT NOT NULL,
            $SEQUENCE_COLUMN INTEGER NOT NULL,
            $BYTES_COLUMN BLOB NOT NULL,
            PRIMARY KEY ($STORAGE_ID_COLUMN, $DOCUMENT_ID_COLUMN, $SEQUENCE_COLUMN),
            FOREIGN KEY ($STORAGE_ID_COLUMN) REFERENCES $WORKSPACE_TABLE($STORAGE_ID_COLUMN) ON DELETE CASCADE
          )
          """.trimIndent()
      )
    }

    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
      error("No mobile database upgrade exists from $oldVersion to $newVersion")
    }
  }
}

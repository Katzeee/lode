package com.lode.mobile

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class LodeDatabasePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      when (name) {
        LodeDatabaseModule.NAME -> LodeDatabaseModule(reactContext)
        else -> null
      }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        LodeDatabaseModule.NAME to
            ReactModuleInfo(
                LodeDatabaseModule.NAME,
                LodeDatabaseModule::class.java.name,
                false,
                false,
                false,
                false,
            )
    )
  }
}

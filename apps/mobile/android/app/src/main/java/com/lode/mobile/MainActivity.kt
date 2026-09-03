package com.lode.mobile

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(LodeDatabasePlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}

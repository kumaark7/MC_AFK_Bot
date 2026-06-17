package com.kumaark7.android_app

import android.content.ActivityNotFoundException
import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "larry_control/termux")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "startBot" -> startBotInTermux(result)
                    else -> result.notImplemented()
                }
            }
    }

    private fun startBotInTermux(result: MethodChannel.Result) {
        val intent = Intent("com.termux.RUN_COMMAND").apply {
            setPackage("com.termux")
            putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            putExtra(
                "com.termux.RUN_COMMAND_ARGUMENTS",
                arrayOf("-lc", "cd ~/MC_AFK_Bot && bash termux/start-bot.sh")
            )
            putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home/MC_AFK_Bot")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
        }

        try {
            startActivity(intent)
            result.success("Termux command sent")
        } catch (err: ActivityNotFoundException) {
            result.error("TERMUX_NOT_FOUND", "Install Termux first.", null)
        } catch (err: Exception) {
            result.error("TERMUX_ERROR", err.message ?: "Unable to start Termux.", null)
        }
    }
}

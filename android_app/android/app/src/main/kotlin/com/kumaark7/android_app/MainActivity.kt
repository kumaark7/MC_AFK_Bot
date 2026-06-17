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
                    "runCommand" -> {
                        val command = call.argument<String>("command")
                        val background = call.argument<Boolean>("background") ?: true

                        if (command.isNullOrBlank()) {
                            result.error("EMPTY_COMMAND", "No Termux command provided.", null)
                        } else {
                            runCommandInTermux(command, background, result)
                        }
                    }
                    "startBot" -> runCommandInTermux("cd ~/MC_AFK_Bot && bash termux/start-bot.sh", true, result)
                    else -> result.notImplemented()
                }
            }
    }

    private fun runCommandInTermux(command: String, background: Boolean, result: MethodChannel.Result) {
        val intent = Intent("com.termux.RUN_COMMAND").apply {
            setPackage("com.termux")
            putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            putExtra(
                "com.termux.RUN_COMMAND_ARGUMENTS",
                arrayOf("-lc", command)
            )
            putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", background)
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

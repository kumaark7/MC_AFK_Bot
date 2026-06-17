package com.kumaark7.android_app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val termuxRunCommandPermission = "com.termux.permission.RUN_COMMAND"

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
                    "openTermux" -> openTermux(result)
                    "startBot" -> runCommandInTermux("cd ~/MC_AFK_Bot && bash termux/start-bot.sh", true, result)
                    else -> result.notImplemented()
                }
            }
    }

    private fun openTermux(result: MethodChannel.Result) {
        try {
            val launchIntent = packageManager.getLaunchIntentForPackage("com.termux")

            if (launchIntent == null) {
                result.error("TERMUX_NOT_FOUND", "Install Termux first.", null)
                return
            }

            startActivity(launchIntent)
            result.success("Termux opened")
        } catch (err: Exception) {
            result.error("TERMUX_ERROR", err.message ?: "Unable to open Termux.", null)
        }
    }

    private fun runCommandInTermux(command: String, background: Boolean, result: MethodChannel.Result) {
        if (checkSelfPermission(termuxRunCommandPermission) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(termuxRunCommandPermission), 3000)
            result.error(
                "TERMUX_PERMISSION",
                "Allow Termux command permission, then tap the button again.",
                null
            )
            return
        }

        val intent = Intent("com.termux.RUN_COMMAND").apply {
            setPackage("com.termux")
            setClassName("com.termux", "com.termux.app.RunCommandService")
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
            startService(intent)
            result.success("Termux command sent")
        } catch (err: ActivityNotFoundException) {
            result.error("TERMUX_NOT_FOUND", "Install Termux first.", null)
        } catch (err: Exception) {
            result.error("TERMUX_ERROR", err.message ?: "Unable to start Termux.", null)
        }
    }
}

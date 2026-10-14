package expo.modules.vaultnative

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.util.Base64
import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import com.lambdapioneer.argon2kt.Argon2Version
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Arrays
import java.util.UUID

/**
 * Native pieces the JS layer can't do itself:
 *  - Argon2 (Hermes has no WebAssembly, and pure-JS Argon2 at 64 MiB is far too slow)
 *  - clipboard copy marked sensitive (hidden from Android 13+ clipboard preview)
 *    with a native-timer clear that still fires while the JS thread is paused.
 */
class VaultNativeModule : Module() {
  private val argon2 by lazy { Argon2Kt() }
  private val mainHandler = Handler(Looper.getMainLooper())
  private var pendingClear: Runnable? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  private val clipboard: ClipboardManager
    get() = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

  override fun definition() = ModuleDefinition {
    Name("VaultNative")

    // Runs on a background queue (AsyncFunction default), never the UI thread.
    AsyncFunction("argon2") { passwordB64: String, saltB64: String, memoryKiB: Int, iterations: Int,
                              length: Int, parallelism: Int, type: Int, version: Int ->
      val password = Base64.decode(passwordB64, Base64.NO_WRAP)
      val salt = Base64.decode(saltB64, Base64.NO_WRAP)
      try {
        val mode = when (type) {
          0 -> Argon2Mode.ARGON2_D
          2 -> Argon2Mode.ARGON2_ID
          else -> throw IllegalArgumentException("Unsupported Argon2 type $type")
        }
        val ver = if (version == 0x10) Argon2Version.V10 else Argon2Version.V13
        val result = argon2.hash(
          mode = mode,
          password = password,
          salt = salt,
          tCostInIterations = iterations,
          mCostInKibibyte = memoryKiB,
          parallelism = parallelism,
          hashLengthInBytes = length,
          version = ver
        )
        val raw = result.rawHashAsByteArray()
        val out = Base64.encodeToString(raw, Base64.NO_WRAP)
        Arrays.fill(raw, 0)
        out
      } finally {
        Arrays.fill(password, 0)
      }
    }

    AsyncFunction("copySensitive") { text: String, clearAfterMs: Int ->
      val label = "noteforge-vault-" + UUID.randomUUID().toString()
      mainHandler.post {
        val clip = ClipData.newPlainText(label, text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          clip.description.extras = PersistableBundle().apply {
            putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
          }
        } else {
          clip.description.extras = PersistableBundle().apply {
            putBoolean("android.content.extra.IS_SENSITIVE", true)
          }
        }
        clipboard.setPrimaryClip(clip)
        pendingClear?.let { mainHandler.removeCallbacks(it) }
        if (clearAfterMs > 0) {
          val r = Runnable { clearIfOurs(label) }
          pendingClear = r
          mainHandler.postDelayed(r, clearAfterMs.toLong())
        }
      }
    }

    AsyncFunction("clearClipboardNow") {
      mainHandler.post { clearIfOurs(null) }
    }
  }

  /** Best effort: skip if we can see the user copied something else since. */
  private fun clearIfOurs(label: String?) {
    pendingClear = null
    try {
      val desc = clipboard.primaryClipDescription // null in background on Android 10+
      val current = desc?.label?.toString()
      if (label != null && current != null && current != label) return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        clipboard.clearPrimaryClip()
      } else {
        clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
      }
    } catch (_: Throwable) {
      // best effort
    }
  }
}

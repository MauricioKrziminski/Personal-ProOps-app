package expo.modules.proopsapkinstaller

import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class ProOpsApkInstallerModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ProOpsApkInstaller")

    Function("canRequestPackageInstalls") {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
        context.packageManager.canRequestPackageInstalls()
    }

    Function("getApkContentUri") { fileUri: String ->
      val parsedUri = Uri.parse(fileUri)
      val filePath = if (parsedUri.scheme == "file") parsedUri.path else fileUri
      val file = File(requireNotNull(filePath) { "O caminho do APK e invalido." })

      FileProvider.getUriForFile(
        context,
        "${context.packageName}.apkInstaller",
        file
      ).toString()
    }
  }
}

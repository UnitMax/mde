const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

// Remove compiler paths from the packaged copies before code signing.
module.exports = async function stripMacNative(context) {
  if (context.electronPlatformName !== 'darwin') return

  const nativeDirectory = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'build',
    'Release',
  )
  for (const file of ['pty.node', 'spawn-helper']) {
    execFileSync('/usr/bin/strip', ['-S', join(nativeDirectory, file)], { stdio: 'inherit' })
  }
}

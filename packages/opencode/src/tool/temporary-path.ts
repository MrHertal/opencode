import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"

export function temporaryPathMetadata(...paths: Array<string | undefined>) {
  const temporaryPaths = Array.from(
    new Set(paths.filter((filepath): filepath is string => !!filepath && FSUtil.contains(Global.Path.tmp, filepath))),
  )
  return temporaryPaths.length ? { temporaryPaths } : {}
}

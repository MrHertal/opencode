import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import * as Tool from "./tool"
import DESCRIPTION from "./present_files.txt"
import { assertExternalDirectoryEffect } from "./external-directory"

const MIMES: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
}

const File = Schema.Struct({
  path: Schema.String.annotate({ description: "The absolute path to a final user-facing document" }),
})

export const Parameters = Schema.Struct({
  files: Schema.Array(File).check(Schema.isMinLength(1)).annotate({
    description: "The final documents to present to the user",
  }),
})

type Metadata = {
  files: Array<{
    path: string
    filename: string
    mime: string
    size: number
  }>
}

export const PresentFilesTool = Tool.define<typeof Parameters, Metadata, FSUtil.Service>(
  "present_files",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const inputs = [...new Set(params.files.map((item) => path.normalize(item.path)))]
          const resolved = yield* Effect.forEach(
            inputs,
            Effect.fnUntraced(function* (filepath) {
              if (!path.isAbsolute(filepath)) {
                return yield* Effect.fail(new Error(`Document path must be absolute: ${filepath}`))
              }

              if (!MIMES[path.extname(filepath).toLowerCase()]) {
                return yield* Effect.fail(new Error(`Unsupported document type: ${filepath}`))
              }

              yield* assertExternalDirectoryEffect(ctx, filepath)
              if (!(yield* fs.existsSafe(filepath))) {
                return yield* Effect.fail(new Error(`File not found: ${filepath}`))
              }

              const canonical = yield* fs.realPath(filepath)
              if (canonical !== filepath) yield* assertExternalDirectoryEffect(ctx, canonical)

              const info = yield* fs.stat(canonical)
              if (info.type !== "File") {
                return yield* Effect.fail(new Error(`Path is not a file: ${filepath}`))
              }

              const mime = MIMES[path.extname(canonical).toLowerCase()]
              if (!mime) {
                return yield* Effect.fail(new Error(`Unsupported document type: ${canonical}`))
              }

              return {
                path: canonical,
                filename: path.basename(canonical),
                mime,
                size: Number(info.size),
              }
            }),
            { concurrency: "unbounded" },
          )
          const files = Array.from(new Map(resolved.map((file) => [file.path, file])).values())
          const label = files.length === 1 ? "file" : "files"

          return {
            title: `Presented ${files.length} ${label}`,
            output: `Presented ${files.length} ${label} to the user.`,
            metadata: { files },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import fs from "fs/promises"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { PresentFilesTool } from "../../src/tool/present_files"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test-present-files-session"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([FSUtil.node, Truncate.node, Agent.node, CrossSpawnSpawner.node])),
)

const init = Effect.fn("PresentFilesToolTest.init")(function* () {
  const info = yield* PresentFilesTool
  return yield* info.init()
})

const run = Effect.fn("PresentFilesToolTest.run")(function* (
  args: Tool.InferParameters<typeof PresentFilesTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

describe("tool.present_files", () => {
  it.instance("returns canonical metadata for supported documents", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const expected = [
        ["report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        ["workbook.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
        ["document.pdf", "application/pdf"],
      ] as const
      const files = expected.map(([filename]) => path.join(test.directory, filename))
      yield* Effect.forEach(files, (file) => Effect.promise(() => fs.writeFile(file, "x")))

      const result = yield* run({
        files: [{ path: files[0] }, { path: files[1] }, { path: files[2] }, { path: files[3] }],
      })

      expect(result.metadata.files).toEqual(
        expected.map(([filename, mime], index) => ({
          path: files[index],
          filename,
          mime,
          size: 1,
        })),
      )
      expect(result.title).toBe("Presented 4 files")
      expect(result.output).toBe("Presented 4 files to the user.")
    }),
  )

  it.instance("deduplicates canonical paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const filepath = path.join(test.directory, "report.docx")
      yield* Effect.promise(() => fs.writeFile(filepath, "document"))

      const result = yield* run({ files: [{ path: filepath }, { path: filepath }] })

      expect(result.metadata.files).toHaveLength(1)
      expect(result.title).toBe("Presented 1 file")
    }),
  )

  it.instance("rejects relative paths", () =>
    Effect.gen(function* () {
      const exit = yield* run({ files: [{ path: "report.docx" }] }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.instance("rejects missing files", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const exit = yield* run({ files: [{ path: path.join(test.directory, "missing.docx") }] }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.instance("rejects directories", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const directory = path.join(test.directory, "folder.pdf")
      yield* Effect.promise(() => fs.mkdir(directory))

      const exit = yield* run({ files: [{ path: directory }] }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.instance("rejects unsupported file types", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const filepath = path.join(test.directory, "notes.txt")
      yield* Effect.promise(() => fs.writeFile(filepath, "notes"))

      const exit = yield* run({ files: [{ path: filepath }] }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.instance("asks once before presenting a duplicate file outside the instance", () =>
    Effect.gen(function* () {
      const outside = yield* tmpdirScoped()
      const filepath = path.join(outside, "report.docx")
      yield* Effect.promise(() => fs.writeFile(filepath, "document"))
      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []

      yield* run(
        { files: [{ path: filepath }, { path: filepath }] },
        {
          ...ctx,
          ask: (request) =>
            Effect.sync(() => {
              requests.push(request)
            }),
        },
      )

      expect(requests).toHaveLength(1)
      expect(requests[0]?.permission).toBe("external_directory")
    }),
  )
})

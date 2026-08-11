import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Format } from "../../src/format"
import { LSP } from "../../src/lsp/lsp"
import { MessageID, SessionID } from "../../src/session/schema"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { EditTool } from "../../src/tool/edit"
import { temporaryPathMetadata } from "../../src/tool/temporary-path"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { WriteTool } from "../../src/tool/write"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test-temporary-path"),
  messageID: MessageID.make("msg_test-temporary-path"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("temporaryPathMetadata", () => {
  test("returns only deduplicated children of the OpenCode temp root", () => {
    const temporary = path.join(Global.Path.tmp, "task", "create_pptx.cjs")
    const outside = path.join(path.dirname(Global.Path.tmp), `${path.basename(Global.Path.tmp)}-other`, "file.txt")

    expect(temporaryPathMetadata(temporary, outside, temporary, undefined)).toEqual({
      temporaryPaths: [temporary],
    })
    expect(temporaryPathMetadata(outside)).toEqual({})
  })
})

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      LSP.node,
      FSUtil.node,
      Format.node,
      EventV2Bridge.node,
      Truncate.node,
      Agent.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

describe("temporary path tool metadata", () => {
  it.instance("marks write, edit, and apply_patch results without changing workspace metadata", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(Global.Path.tmp, "metadata-test-")))
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })))

      const writeInfo = yield* WriteTool
      const write = yield* writeInfo.init()
      const editInfo = yield* EditTool
      const edit = yield* editInfo.init()
      const applyPatchInfo = yield* ApplyPatchTool
      const applyPatch = yield* applyPatchInfo.init()

      const script = path.join(directory, "create_pptx.cjs")
      const written = yield* write.execute({ filePath: script, content: "const value = 1\n" }, ctx)
      expect(written.metadata.temporaryPaths).toEqual([script])

      const edited = yield* edit.execute(
        { filePath: script, oldString: "const value = 1", newString: "const value = 2" },
        ctx,
      )
      expect(edited.metadata.temporaryPaths).toEqual([script])

      const workspaceFile = path.join(instance.directory, "visible.txt")
      const visible = yield* write.execute({ filePath: workspaceFile, content: "before\n" }, ctx)
      expect(visible.metadata.temporaryPaths).toBeUndefined()

      const moved = path.join(directory, "moved.txt")
      const patched = yield* applyPatch.execute(
        {
          patchText: `*** Begin Patch\n*** Update File: visible.txt\n*** Move to: ${moved}\n@@\n-before\n+after\n*** End Patch`,
        },
        ctx,
      )
      expect(patched.metadata.temporaryPaths).toEqual([moved])
    }),
  )
})

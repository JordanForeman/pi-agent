import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { IntegrationExtensionCore } from "../extension-core/integration-extension-core";
import { ScratchWorkspaceRegistry } from "./scratch-workspace-core.mjs";

class ScratchWorkspaceExtension extends IntegrationExtensionCore {
  private readonly registry = new ScratchWorkspaceRegistry();

  constructor(pi: ExtensionAPI) {
    super(pi, {
      id: "scratch-workspace",
      name: "Scratch Workspace",
      summary: "Ownership-checked disposable workspace lifecycle",
    });
  }

  protected registerExtension(): void {
    this.pi.registerTool({
      name: "scratch_workspace",
      label: "Scratch Workspace",
      description: "Create or remove a session-owned disposable directory directly under the OS temp directory. Removal accepts only an exact root created by this tool in the current session.",
      promptSnippet: "Create and remove ownership-checked disposable scratch directories",
      promptGuidelines: [
        "Use scratch_workspace instead of shell deletion for disposable clones, fixtures, and research artifacts; remove only the exact path it returned.",
      ],
      parameters: Type.Object({
        action: StringEnum(["create", "remove"] as const),
        path: Type.Optional(Type.String({ description: "Exact path returned by a prior create action; required for remove." })),
      }),
      execute: async (_toolCallId, params, signal) => {
        signal?.throwIfAborted();
        if (params.action === "create") {
          const result = await this.registry.create();
          return {
            content: [{ type: "text" as const, text: `Created owned scratch workspace: ${result.path}` }],
            details: { action: "create", ...result },
          };
        }

        if (!params.path) throw new Error("scratch_workspace remove requires the exact path returned by create");
        const result = await this.registry.remove(params.path);
        return {
          content: [{ type: "text" as const, text: `Removed owned scratch workspace: ${result.path}` }],
          details: { action: "remove", ...result },
        };
      },
    });

    this.pi.on("session_shutdown", async () => {
      await this.registry.cleanupAll();
    });
  }
}

export default function scratchWorkspace(pi: ExtensionAPI): void {
  new ScratchWorkspaceExtension(pi).register();
}

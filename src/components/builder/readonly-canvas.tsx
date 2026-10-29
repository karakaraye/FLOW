"use client";
import { useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  normalizeDocument,
  toCanvas,
  type CanvasNode,
} from "@/lib/builder/document";
import type { Definition } from "@/lib/engine/definition";
import { nodeTypes } from "./engine-node";
export default function ReadonlyCanvas({
  definition,
  editor,
  statuses = {},
}: {
  definition: unknown;
  editor: unknown;
  statuses?: Record<string, { status: string; error?: string | null }>;
}) {
  const graph = useMemo(
    () =>
      toCanvas(
        normalizeDocument("Read-only source", definition as Definition, editor),
        statuses,
      ),
    [definition, editor, statuses],
  );
  return (
    <ReactFlow<CanvasNode>
      nodes={graph.nodes}
      edges={graph.edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.15}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      deleteKeyCode={null}
    >
      <Background />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable ariaLabel="Workflow minimap" />
    </ReactFlow>
  );
}

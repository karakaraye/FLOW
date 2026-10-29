"use client";
import { useEffect, useState } from "react";
import type { Data, NodeType } from "@/lib/engine/definition";
import { whatsappConfig } from "@/lib/whatsapp/config";
export function initialWhatsAppConfig(type: string): Data {
  return {
    connectionId: "",
    ...(type === "whatsapp_message_received"
      ? { phoneNumberId: "", contains: "" }
      : type === "whatsapp_send_template"
        ? {
            toPath: "from",
            templateId: "",
            language: "en_US",
            parameters: [],
            parameterPaths: [],
          }
        : { toPath: "from", body: "Thanks for your message." }),
  };
}
type Connection = {
  id: string;
  businessName: string;
  integration: { status: string };
  phones: { id: string; providerPhoneId: string; verifiedName: string }[];
};
type Template = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  body: string;
  parameters: number;
  supported: boolean;
};
export function WhatsAppFields({
  workspaceId,
  type,
  value,
  onChange,
  disabled,
  onValidityChange,
}: {
  workspaceId: string;
  type: NodeType;
  value: Data;
  onChange: (c: Data) => void;
  disabled: boolean;
  onValidityChange: (v: boolean) => void;
}) {
  const [connections, setConnections] = useState<Connection[]>([]),
    [templates, setTemplates] = useState<Template[]>([]);
  useEffect(() => {
    void fetch(`/api/workspaces/${workspaceId}/whatsapp/overview`)
      .then((r) => (r.ok ? r.json() : { connections: [] }))
      .then((d) => setConnections(d.connections))
      .catch(() => setConnections([]));
  }, [workspaceId]);
  useEffect(() => {
    if (type !== "whatsapp_send_template" || !value.connectionId) return;
    void fetch(
      `/api/workspaces/${workspaceId}/whatsapp/templates?connectionId=${encodeURIComponent(String(value.connectionId))}`,
    )
      .then((r) => (r.ok ? r.json() : []))
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [workspaceId, type, value.connectionId]);
  useEffect(() => {
    try {
      whatsappConfig(type, value);
      onValidityChange(true);
    } catch {
      onValidityChange(false);
    }
  }, [type, value, onValidityChange]);
  const cls =
      "mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs",
    field = (k: string, v: Data[string]) => onChange({ ...value, [k]: v });
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="text-xs font-semibold">WhatsApp configuration</legend>
      <p className="text-xs text-stone-500">
        Requires a verified developer test connection. Text replies need an open
        24-hour service window; utility templates need recorded consent.
        Operator-approved test recipients only.
      </p>
      {!connections.some((c) => c.integration.status === "CONNECTED") && (
        <p role="status" className="text-xs text-amber-800">
          Connection required. Configure WhatsApp Business in Integrations.
        </p>
      )}
      <label className="block text-xs">
        WhatsApp connection
        <select
          aria-label="WhatsApp connection"
          className={cls}
          value={String(value.connectionId ?? "")}
          onChange={(e) =>
            onChange({
              ...value,
              connectionId: e.target.value,
              ...(type === "whatsapp_message_received"
                ? {
                    phoneNumberId:
                      connections.find((c) => c.id === e.target.value)
                        ?.phones[0]?.providerPhoneId ?? "",
                  }
                : {}),
            })
          }
        >
          <option value="">Select connection</option>
          {connections
            .filter((c) => c.integration.status === "CONNECTED")
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.businessName}
              </option>
            ))}
        </select>
      </label>
      {type === "whatsapp_message_received" ? (
        <>
          <label className="block text-xs">
            Phone-number identity
            <select
              aria-label="WhatsApp phone number"
              className={cls}
              value={String(value.phoneNumberId ?? "")}
              onChange={(e) => field("phoneNumberId", e.target.value)}
            >
              <option value="">Select phone</option>
              {connections
                .find((c) => c.id === value.connectionId)
                ?.phones.map((p) => (
                  <option key={p.id} value={p.providerPhoneId}>
                    {p.verifiedName} · {p.providerPhoneId}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-xs">
            Optional text contains
            <input
              className={cls}
              maxLength={80}
              value={String(value.contains ?? "")}
              onChange={(e) => field("contains", e.target.value)}
            />
          </label>
          <p className="text-xs text-stone-500">
            Input: from, text, providerMessageId, phoneNumberId, receivedAt.
            Signed text messages only; media is recorded as unsupported.
            Publish, then explicitly activate this version in the WhatsApp
            dashboard.
          </p>
        </>
      ) : (
        <>
          <label className="block text-xs">
            Recipient source
            <select
              aria-label="WhatsApp recipient source"
              className={cls}
              value={value.toPath !== undefined ? "path" : "literal"}
              onChange={(e) => {
                const n = { ...value };
                delete n.to;
                delete n.toPath;
                onChange({
                  ...n,
                  ...(e.target.value === "path"
                    ? { toPath: "from" }
                    : { to: "15550000001" }),
                });
              }}
            >
              <option value="path">Input field path</option>
              <option value="literal">Literal international digits</option>
            </select>
          </label>
          <label className="block text-xs">
            Recipient
            <input
              aria-label="WhatsApp recipient"
              className={cls}
              value={String(value.toPath ?? value.to ?? "")}
              onChange={(e) =>
                field(
                  value.toPath !== undefined ? "toPath" : "to",
                  e.target.value,
                )
              }
            />
          </label>
          {type === "whatsapp_send_message" ? (
            <>
              <label className="block text-xs">
                Body source
                <select
                  className={cls}
                  value={value.bodyPath !== undefined ? "path" : "literal"}
                  onChange={(e) => {
                    const n = { ...value };
                    delete n.body;
                    delete n.bodyPath;
                    onChange({
                      ...n,
                      ...(e.target.value === "path"
                        ? { bodyPath: "reply" }
                        : { body: "Thanks for your message." }),
                    });
                  }}
                >
                  <option value="literal">Literal text</option>
                  <option value="path">Input field path</option>
                </select>
              </label>
              <label className="block text-xs">
                Text reply
                <input
                  aria-label="WhatsApp text reply"
                  className={cls}
                  maxLength={4096}
                  value={String(value.bodyPath ?? value.body ?? "")}
                  onChange={(e) =>
                    field(
                      value.bodyPath !== undefined ? "bodyPath" : "body",
                      e.target.value,
                    )
                  }
                />
              </label>
            </>
          ) : (
            <>
              <label className="block text-xs">
                Approved utility template
                <select
                  aria-label="WhatsApp approved template"
                  className={cls}
                  value={String(value.templateId ?? "")}
                  onChange={(e) => {
                    const t = templates.find((t) => t.id === e.target.value);
                    if (t)
                      onChange({
                        ...value,
                        templateId: t.id,
                        language: t.language,
                        parameters: Array(t.parameters).fill(""),
                        parameterPaths: Array(t.parameters).fill(""),
                      });
                  }}
                >
                  <option value="">Select provider-approved template</option>
                  {templates
                    .filter((t) => t.supported && t.status === "APPROVED")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.language} · {t.status}
                      </option>
                    ))}
                </select>
              </label>
              <p className="text-xs">
                Language: {String(value.language ?? "")} · Approval is rechecked
                with Meta before sending.
              </p>
              <p className="rounded border p-2 text-xs whitespace-pre-wrap">
                {templates.find((t) => t.id === value.templateId)?.body ??
                  "No approved template selected."}
              </p>
              {((value.parameters as string[]) ?? []).map((v, i) => (
                <div key={i}>
                  <label className="block text-xs">
                    Parameter {i + 1} literal
                    <input
                      aria-label={`WhatsApp parameter ${i + 1}`}
                      className={cls}
                      value={v}
                      onChange={(e) =>
                        field(
                          "parameters",
                          (value.parameters as string[]).map((x, j) =>
                            j === i ? e.target.value : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs">
                    Parameter {i + 1} input path (optional)
                    <input
                      className={cls}
                      value={
                        (value.parameterPaths as string[] | undefined)?.[i] ??
                        ""
                      }
                      onChange={(e) =>
                        field(
                          "parameterPaths",
                          (value.parameters as string[]).map((_, j) =>
                            j === i
                              ? e.target.value
                              : ((
                                  value.parameterPaths as string[] | undefined
                                )?.[j] ?? ""),
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </fieldset>
  );
}

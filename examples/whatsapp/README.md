# Controlled WhatsApp examples — configuration required

These are **unpublished examples, not ready-to-use catalog templates**. No real Meta or AI connectivity has been verified. Import a JSON definition in the builder only after replacing placeholders. `000000` is a non-operational placeholder, not an authorized phone/template ID.

- A: signed incoming text → approved AI classification → condition → internal shape-only log events. No outbound messaging.
- B: authenticated FlowPilot webhook → fresh Meta-approved UTILITY template. Requires explicit recipient consent, approved test recipient, matching provider template/language/positional parameters, nonzero send limits, and a separately configured signed FlowPilot webhook.
- C: signed incoming text → literal set-data reply → policy-checked service reply. Requires an open service window and unsuppressed approved test recipient.
- D: signed incoming text → approved AI summarization → internal shape-only event. No outbound messaging.

Replace every connection, phone and template ID with verified workspace identities. For A/D, configure an approved model, explicit data-sharing policy and AI budget; AI may incur provider charges. AI text is untrusted and cannot grant consent, extend a messaging window or select another connection. Logs record shapes, not summary/classification contents.

Publish only after reviewing the graph. Activate the incoming version explicitly in the WhatsApp dashboard. Verify with isolated fixtures first. Real Meta tests require explicit operator authorization of a test recipient; none were attempted for this milestone. Do not publish examples into the template catalog as ready until their provider configuration and behavior have been verified.

# Set up model-routed subagents

Use this skill to choose which existing Harness model routes are exposed through the `subagent_route` tool, then generate concise routing guidance for each route. Configuration lives in `<DSH_HOME>/subagent-setup/config.json` and is re-read on every delegation (no hot reload for external edits).

## Workflow

1. Call `subagent_route_catalog` before proposing configuration. It reports the current agent route and the models advertised by each registered provider.
2. Treat the catalog as advisory. A provider may accept an unlisted model id, but never invent an unlisted route without the user naming or confirming it.
3. Show a compact shortlist with exact `provider/model` identities and distinguish alternatives from the current agent route.
4. Ask one concise multi-select question for the routes the user wants exposed. If the user already named them, do not ask again.
5. Determine a concrete routing role for every selected model before writing tags or descriptions:
   - First infer suitable workloads from the exact `provider/model` identity, catalog metadata, and reliable general knowledge about that model family.
   - Use inferred knowledge only when it supports a meaningful task distinction, such as routine implementation, deep architecture reasoning, large-context review, security analysis, multimodal work, or inexpensive background work.
   - If the evidence is missing, uncertain, or does not distinguish this route from the others, do not produce a generic fallback. Use `ask_user_question` once with one multi-select question per ambiguous model. Offer 3-5 concrete workload options appropriate to the available evidence and include a "Custom role" option. Examples include routine coding, complex debugging, architecture and planning, adversarial review, large-context synthesis, and multimodal analysis.
   - Treat the user's selected options as their routing policy. If they select "Custom role," ask only for the missing custom wording.
6. For each route propose:
   - a short lowercase alias used by the tool's `model` argument. **Prefer a neutral handle** (`a1`…`aN`): the alias is the token the model actually writes, and a handle that echoes a model family or a word such as `pro`/`max` measurably pulls selection away from the descriptions. Measured on one contradiction-audit task: the descriptively matched route was picked 0/2 times with branded aliases and 6/6 with neutral ones. Keep the human-readable name in `displayName`, not in the alias;
   - 2-5 lowercase kebab-case tags that reflect its concrete routing role;
   - a one-sentence `description` beginning with "Use for …" or "Use when …" that names the work to delegate and, where useful, how it differs from the other configured routes.
7. Reject circular or content-free descriptions. Never write phrases such as "when selecting this route," "when using this model," "for broad tasks," or "suitable for all kinds of tasks." A valid description must help an agent choose between at least two configured routes without relying on their aliases or model names.
8. Ground factual claims in provider metadata or reliable model knowledge. Do not invent claims about price, speed, context size, privacy, benchmark rank, or modalities. When such a property would affect routing but is uncertain, ask the user instead.
9. Call `subagent_route_configure` with `action: "get"` to preserve the current backend, depth, background, and listing-inactivity defaults unless the user asked to change them.
10. Present the complete proposed replacement model list and obtain explicit confirmation before writing settings.
11. After confirmation, call `subagent_route_configure` with `action: "update"` and the complete `models` array. Pass `subagent_provider`, `max_depth`, `enable_run_in_background`, or `listing_inactivity_turns` only when the user approved changing those values. Do not edit `config.json` directly while this tool is available.
12. If the update fails (invalid entries, an unwritable file, or a corrupted existing file), show the user the proposed JSON below and ask them to fix or replace `<DSH_HOME>/subagent-setup/config.json` manually; do not retry the tool blindly.
13. Settings apply live: every `subagent_route` call re-reads `config.json`, and the tool re-registers after a successful save through either the settings UI (PUT) or `subagent_route_configure`. Verify that `subagent_route` is visible and its `model` parameter description lists the selected aliases. There is no fixed enum on `model`; an unknown alias is rejected per call with the current alias list. If `config.json` is edited externally, the next `subagent_route` call still accepts a newly added alias (it is validated against the re-read config) and then re-registers to refresh the listing.

## Settings shape

`<DSH_HOME>/subagent-setup/config.json`:

```json
{
  "subagentProvider": "spawn",
  "maxDepth": 3,
  "enableRunInBackground": true,
  "listingInactivityTurns": 20,
  "models": [
    {
      "alias": "fast",
      "provider": "provider-id",
      "model": "exact-model-id",
      "displayName": "Human-readable model name",
      "tags": ["fast", "routine"],
      "description": "Use for quick, well-scoped tasks where the user prefers low latency.",
      "maxTokens": 8192,
      "reasoningEffort": "low"
    }
  ]
}
```

To offer one model at two efforts (for example quick and deep), add two aliases on the same route with different `reasoningEffort` values and routing descriptions.

`alias` values must be unique and use lowercase letters, numbers, underscores, or hyphens. Tags must be lowercase kebab-case. `provider` is the LLM route; `subagentProvider` is the execution backend and normally remains `spawn`. `listingInactivityTurns: 0` disables stale-list filtering.

## Editing safety

- `subagent_route_configure` is the preferred model-facing write path. It is limited to `<DSH_HOME>/subagent-setup/config.json`, validates the same schema as the UI, and needs no filesystem permission beyond the plugin's own write path.
- Never call its `update` action without a direct user request and explicit confirmation of the complete replacement list.
- Prefer the settings UI when guiding a human through manual configuration.
- Never edit the plugin package's own `plugin/cordis.patch.yml`; it only mounts the plugin.
- Direct editing of `<DSH_HOME>/subagent-setup/config.json` is a fallback only when the configuration tool is unavailable or refused. Change only that file, keep valid JSON with UTF-8 (no BOM), and use normal approval escalation if the file is outside the workspace.

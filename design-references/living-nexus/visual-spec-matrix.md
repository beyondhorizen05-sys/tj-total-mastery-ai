# Living Nexus visual specification matrix

The user-supplied renders are stored in `design-references/living-nexus/images/` and are visual specifications only. They must not be shipped from the web public directory or displayed as a runtime screen, CSS background, 3D texture, or marker surface. Rebuild the visual composition with real UI and procedural geometry. Preserve genuine TJ data and actions; image-only controls and invented activity are unacceptable.

| Named reference | Image asset | Intended screen | Implementation state |
|---|---|---|---|
| Main Interface | `main-interface.jpg` | App shell and Living Nexus command surface: dark cinematic control room, cyan light, central core, compact holographic panels | Native HTML/CSS city chamber, five live action bays, energy core and telemetry replace the image background; API-backed metrics/routes remain; browser screenshot checked, exact pixel parity pending. |
| Living World | `living-world.jpg` | Multi-level isometric headquarters, transparent floors, glowing central tower and distinct work areas | Native React Three Fiber two-level HQ replaces both the screenshot overlay and simplified town. Rooms, atrium, structural supports, connecting stairs, core and agent avatars are procedural geometry; avatar motion follows live agent status from `/api/v1/town/state`. Browser screenshot and all room routes checked; richer architectural detail and exact visual parity still need iteration. |
| Mission Control | `mission-control.jpg` | Circular command room, panoramic live dashboards, central table and blue ceiling light | Native React/CSS room composition replaces the image; live task counts, status filters, progress and refresh remain. Browser route and task queue verified; screenshot parity pending. |
| Collaboration Hall | `collaboration-hall.jpg` | Bright futuristic meeting room, shared holographic globe and conferencing displays | Native room architecture replaces the image background; meeting roster/state comes from live APIs with truthful empty states, and Studio actions remain available. HQ room route verified. Do not claim real conferencing without an API. |
| Research Lab | `research-lab.jpg` | Modern laboratory with transparent holographic scientific screens | Native React/CSS lab geometry and display panels replace the image; upload, model selection and analysis remain live. HQ route verified; live vision inference and screenshot parity pending. |
| Workflow | `workflow.jpg` | Three-pane visual node editor: component library, dotted graph canvas, inspector and workflow actions | Three-pane editor now uses native graph/canvas styling without the reference backdrop; real API-backed draft/save/run/schedule actions remain; browser view checked, screenshot parity pending. |
| Focus | `focus.jpg` | Copilot-style command hub with capability cards, central prompt/action review, files/code left, timeline/audit right | Three-column workspace uses API-fed data and existing panes; its background now uses native gradients/grid styling rather than the supplied image; screenshot parity remains to verify |

## Reference matching rules

- Compare each screen at the same viewport ratio as its reference image; preserve its lighting, panel hierarchy, camera/composition, spacing, and accent colors.
- Keep run status, agent markers, task history, logs, model choices, and workflow edges tied to API data.
- Missing live data should render a truthful empty or unavailable state.
- The uploaded renders are image references. Their depicted text and controls are not proof that those functions exist in TJ.

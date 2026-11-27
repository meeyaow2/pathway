# Pathway design system

Pathway uses **purple**, a colour widely associated with disability inclusion, dignity and empowerment, as the colour of its brand and of interaction. Everything else is quiet, so the map stays readable and state colours stay meaningful.

**Principles**
- **Calm.** Lots of white and lavender-tinted neutrals. Purple marks what you can act on, and what's selected.
- **Honest.** Caution is always amber with a "!" mark and words such as *Not verified*, *Data needed* or *Demo*. Pathway never says *accessible* or *safe* without data that supports it.
- **Never colour alone.** Every state is paired with text, a shape, an icon or a pattern.
- **Mobile first.** 48px touch targets, thumb-reachable controls, and the map kept visible.

All values live as CSS custom properties in [`public/styles.css`](../public/styles.css), section 1. Components use only the **semantic** tokens. Map layers read the `--map-*` tokens at runtime, so high-contrast mode restyles the map as well.

## Colour

### Palette (primitives)
| Token | Hex | Use |
|---|---|---|
| `--purple-50` | `#FCFAFF` | App background |
| `--purple-100` | `#F2EDFF` | Selected/soft surfaces, tab pill |
| `--purple-200` | `#E4DAFC` | Pressed states, focus glow on fields |
| `--purple-400` | `#9B80E5` | Secondary purple: **decoration and large text only** (3.2:1 on white) |
| `--purple-500` | `#7C5CD6` | Secondary purple that's safe for text (4.8:1) |
| `--purple-600` | `#6941C6` | **Primary**: buttons, selected route, start marker, focus ring (6.6:1 on white) |
| `--purple-700` | `#53339F` | Hover; purple text on soft purple (7.8:1 on `#F2EDFF`) |
| `--purple-800` / `900` | `#3E2577` / `#2A1856` | Pressed; high-contrast brand |
| `--ink-900` | `#241B35` | Primary text (15.8:1 on background); destination marker |
| `--ink-600` | `#5B5270` | Secondary text (7.0:1) |
| `--ink-400` | `#8C82A3` | Input, chip and card borders (3.6:1, meets 1.4.11 non-text contrast) |
| `--ink-200` | `#DDD5EC` | Dividers (decorative only) |
| `--amber-50` / `400` / `800` | `#FFF4DC` / `#E7B45D` / `#6B3A00` | Caution: unverified, demo, data needed (8.6:1 text) |
| `--red-50` / `700` | `#FEECEB` / `#B42318` | Errors and "possibly off route" (6.6:1) |
| `--orange-700` | `#C2410C` | Barrier-report markers and report button |
| `--blue-600` | `#1A66D9` | "You are here" GPS dot only (a navigation convention) |

### How the proposed palette was refined
- `#6941C6`, `#F2EDFF`, `#FCFAFF` and `#241B35` are used as proposed. All pass WCAG 2.2 AA.
- `#9B80E5` is only 3.2:1 on white. It passes for large text and UI components, but not for body text. It's kept for decoration, and `#7C5CD6` is used wherever secondary purple must be readable.
- `#8C82A3` was added for component borders, because a pale lavender border wouldn't make inputs identifiable.

### Semantic tokens
`--color-bg`, `--color-surface`, `--color-surface-sunken`, `--color-text`, `--color-text-muted`, `--color-text-brand`, `--color-text-on-brand`, `--color-border`, `--color-border-strong`, `--color-brand`, `--color-brand-hover`, `--color-brand-pressed`, `--color-brand-soft`, `--color-brand-muted`, `--color-warning-*`, `--color-danger*`, `--color-focus`, `--color-focus-halo`, `--color-scrim`, `--color-toast-bg`, and the map tokens `--map-route`, `--map-route-alt`, `--map-route-casing`, `--map-start`, `--map-end`, `--map-report`, `--map-gps`.

### High-contrast mode
`html.pw-contrast` redefines the semantic tokens: black text and borders, darker purples (`#3E2577` and `#2A1856`), 2px component borders, and a black focus ring. No component has its own high-contrast rules beyond border width. Windows forced-colours mode adds a system `Highlight` outline to selected states.

## Typography
System font stack (`--font-sans`), so it renders natively on iOS, Android and desktop with no font download.

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12px | Chip status, tags |
| `--text-sm` | 14px | Metadata, hints |
| `--text-base` | 16px | Body, inputs (16px also stops iOS zooming into fields) |
| `--text-md` | 17px | Section headings, brand |
| `--text-lg` | 20px | Page headings |
| `--text-xl` | 22px | Route duration |

Weights are 400, 550, 650 and 750, and line height is 1.45. **Larger text** sets the root size to 19px, and every size scales because they're all in rem.

## Space, shape and elevation
- **Spacing:** a 4-point scale, `--space-1` (4px) to `--space-8` (32px).
- **Radii:** `--radius-sm` 8px, `md` 12px (buttons, inputs), `lg` 16px (cards), `xl` 20px (sheet, dialog), `pill`.
- **Elevation:**
  - `--shadow-1`: primary buttons
  - `--shadow-2`: floating cards and map buttons
  - `--shadow-sheet`: the bottom sheet

## Components

| Component | Anatomy and states | Accessibility |
|---|---|---|
| **Primary button** `.btn.primary` | Purple fill, white text, 48px tall. Hover `--purple-700`, pressed `--purple-800`, disabled at 50% opacity, busy shows a spinner | Verb-first labels; `aria-busy` while working |
| **Secondary button** `.btn` | White, strong border, purple text; soft-purple hover | — |
| **Icon button / map button** `.icon-btn` `.fab` | 48px (phone) or 52px. Pressed (*Follow*) = purple fill | Always has an `aria-label`; the focus ring has a white halo so it shows over the map |
| **Search field** `.field-row` | Label (dot + "From"/"To"), input, action. Focus = purple border + glow | `role="combobox"`, `aria-activedescendant`, results in a listbox |
| **Suggestion** `[role=option]` | Active = soft purple + 4px purple left bar | Arrow keys, Enter, Escape |
| **Route card** `.route-card` | A line swatch matching the map, title, duration, distance, stairs/lift/crossing counts, explanation, "★ Best match" tag. Selected = 2px purple border, soft-purple fill, "✓ Selected" | `aria-pressed`; selection is announced |
| **Preference chip** `.chip` | Name + status line (*Changes routes* / *Changes display* / *Data needed, not applied yet*). Selected = purple fill + ✓ | `aria-pressed`; the status is part of the accessible name |
| **Status flag** `.flag` | Amber + "!" = caution/unverified; purple + ✓ = ok; red + "!" = alert | Text always present |
| **Callout** `.callout` | Amber panel for safety and verification messages | — |
| **Bottom sheet** `.sheet` | Grip handle and three heights: peek (190px, or 236px with a route), half, full. Becomes a floating card from 600px and a side panel from 900px | The handle is a button with `aria-expanded`; drag or tap |
| **Tab bar** `.tabbar` | Four tabs with icon + label. Current = purple text + soft-purple pill (mobile) or purple underline (desktop) | `aria-current="page"`; focus moves to the page heading |
| **Dialog** `.modal` | Bottom sheet on phones, centred from 600px | Focus trap, Escape, focus returns to the opener |
| **Toast** | Ink background, white text | `role="status"` |
| **Directions** `.steps` | Numbered circles; current step = purple. Stairs/Lift/Crossing labels in text | Ordered list |

## Map
| Element | Style | Distinguished by |
|---|---|---|
| Selected route | Purple 6px solid line with a white casing | Colour + width + solid line |
| Alternative route | Grey-violet 4px **dashed** line | Pattern + width |
| Illustration (routing unavailable) | Purple dotted line | Pattern + the "Straight-line illustration" label |
| Start | Purple **circle** "A" | Shape + letter + accessible label |
| Destination | Ink **teardrop** pin "B" | Shape + letter + accessible label |
| You are here | Blue dot with halo | Convention |
| Demo barrier report | Orange circle with a white ring | Popup says "Local demo report" |

The basemap is unchanged (OpenFreeMap Liberty/Positron or OneMap), so purple appears only on things Pathway draws.

## States checklist (for new components)
- **Default, hover, active, focus-visible, disabled, busy:** all need styles.
- **Selected or pressed:** show a ✓ or text, not just a colour.
- **Touch targets:** at least 48px for primary controls and at least 24px for everything else (WCAG 2.2 2.5.8).
- **Contrast:** text at least 4.5:1, large text and UI components at least 3:1. Check in high-contrast mode too.
- **Motion:** honour `prefers-reduced-motion`.

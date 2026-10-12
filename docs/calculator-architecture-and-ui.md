# Calculator Architectural Design & UI/UX Specifications

**Author:** Designer (TJ's companion & UI/UX specialist)  
**Target User:** Jazib  
**Project:** Simple Calculator Application  

---

## 1. Architectural Design

The calculator follows a clean **Model-View-Controller (MVC) / State Machine architecture** to ensure robust input handling, separation of concerns, and testability.

### **Component Breakdown**
1. **Model (State Management Engine):**
   * **State Properties:**
     * `currentInput`: String representing the currently typed digits/decimal.
     * `previousInput`: String representing the stored operand before an operator is applied.
     * `operator`: Active operator (`+`, `-`, `*`, `/`) or `null`.
     * `expressionDisplay`: Breadcrumb string showing the full expression history (e.g., `12 + 5`).
     * `error`: String or `null` (e.g., `"Error: Division by zero"`).
   * **State Transitions & Error Recovery (NFR4):**
     * Double operator entry (e.g., `5 ++ 3`) overwrites or gracefully ignores the previous operator.
     * Division by zero triggers an explicit error state, disabling further operations until a "Clear" (C/AC) action is executed.

2. **Controller (Business Logic & Arithmetic):**
   * Implements strict decimal precision rounding (up to 8 decimal places) to mitigate JavaScript floating-point drift anomalies (`0.1 + 0.2 = 0.3`).
   * Enforces sub-$100\text{ ms}$ calculation response times (NFR1).

3. **View (UI Presentation Layer):**
   * Renders the keypad and display screen dynamically.
   * Responsive CSS Grid layout suitable for web browsers and mobile viewports (NFR5).

---

## 2. UI/UX Layout & Accessibility Specifications

### **Visual Theme & Styling (NFR2)**
* **Palette:** Modern sleek dark mode with high-contrast text.
  * *Background:* Deep slate (`#0f172a` / `#1e293b`)
  * *Display Screen:* High contrast dark charcoal (`#090d16`) with bright cyan/white glowing text (`#38bdf8`)
  * *Number Keys:* Neutral dark gray (`#334155`) with hover transitions
  * *Operator Keys:* Warm amber/orange (`#f59e0b` or `#f97316`)
  * *Action Keys (C, AC, =):* Accent coral/red (`#ef4444`) or primary blue (`#3b82f6`)
* **Accessibility (WCAG AA Compliant):**
  * Minimum contrast ratio of 4.5:1 for all button text.
  * Clear focus states and keyboard navigation support (`Tab` and `Enter` key bindings).

---

## 3. Single-File HTML/CSS/JS Prototype Implementation

Below is the complete, production-ready interactive prototype implementing all functional and non-functional requirements. You can save and open this in any browser!

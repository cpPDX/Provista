# User-facing change checklist

Use this checklist whenever a change affects how a person interacts with Provista.

The goal is not to update every surface on every release. The goal is to prevent product guidance from describing an interaction that no longer exists.

## Definition of done

For every user-facing workflow change:

1. Identify the interaction that changed.
2. Review every existing surface that explains or demonstrates that interaction.
3. Update affected guidance in the same PR.
4. Leave unrelated surfaces alone.
5. Update or add tests when guidance, navigation, labels, or expected behavior changed.
6. Run the normal API and browser CI gates before merge.

## Surfaces to review

- Setup wizard / onboarding
- App Tour
- In-app Help / About and contextual guidance
- Empty states, labels, hints, and action copy near the changed workflow
- Marketing site feature/workflow copy and screenshots, but only when the changed behavior is represented there
- README or product documentation when it describes the changed workflow
- Automated tests that assert the old interaction or guidance

## PR expectation

A user-facing PR should state one of the following for each relevant surface:

- **Updated** - the surface described the changed interaction and was updated.
- **Reviewed - no change needed** - the surface remains accurate or does not describe the changed interaction.
- **Not applicable** - the surface has no relationship to the change.

Do not merge a user-facing workflow change with known stale guidance.
# Reserved shadcn components

Questi componenti shadcn non sono attualmente usati ma sono **riservati per uso futuro** negli Sprint 2-5 del piano di ristrutturazione UI/UX.

## Pianificazione uso

| Componente | Sprint previsto | Uso previsto |
|------------|----------------|--------------|
| `alert-dialog` | Sprint 3-5 | Conferme distruttive (delete tool, revoke delegation, reject action) — rimpiazza `confirm()` nativo |
| `table` | Sprint 5 | Liste strutturate (gates, delegations, traces) — rimpiazza `<ul>` custom |
| `popover` | Sprint 3-4 | Tooltip avanzati, skill picker popover nella Console |
| `form` | Sprint 5 | Form validation con react-hook-form — rimpiazza `useState` manuale |

## Come reintrodurli

Quando servono in uno sprint:
1. Spostare il file da `_reserved/` a `src/components/ui/`
2. Verificare che le dipendenze siano ancora installate (es. `@radix-ui/react-alert-dialog`)
3. Importare normalmente: `import { AlertDialog } from '@/components/ui/alert-dialog'`

Se uno di questi rimane inutilizzato anche dopo Sprint 5, eliminarlo definitivamente.

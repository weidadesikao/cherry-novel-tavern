import { Badge, Button, Checkbox, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface PresetEntryToggleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Verbatim ST preset JSON. */
  presetJson: Record<string, unknown> | undefined
  /** Which prompt_order list to edit (matches the assembly's characterId). */
  characterId: string
  /** Persists the updated preset JSON (PATCH through the preset endpoint). */
  onSave: (json: unknown) => Promise<void>
}

interface OrderRow {
  identifier: string
  name: string
  role: string
  marker: boolean
  enabled: boolean
}

/**
 * SillyTavern-style per-entry toggle list. Toggling edits the chosen
 * `prompt_order` list's `enabled` flags (exactly what ST's prompt-manager
 * switches do) and saves the whole preset JSON back — prompt contents are
 * never touched.
 */
const PresetEntryToggleDialog = ({
  open,
  onOpenChange,
  presetJson,
  characterId,
  onSave
}: PresetEntryToggleDialogProps) => {
  const { t } = useTranslation()
  const [rows, setRows] = useState<OrderRow[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const promptsById = useMemo(() => {
    const map = new Map<string, { name: string; role: string; marker: boolean }>()
    const prompts = (presetJson?.prompts as Array<Record<string, unknown>> | undefined) ?? []
    for (const prompt of prompts) {
      const identifier = String(prompt.identifier ?? '')
      if (!identifier) continue
      map.set(identifier, {
        name: String(prompt.name ?? identifier),
        role: String(prompt.role ?? 'system'),
        marker: prompt.marker === true
      })
    }
    return map
  }, [presetJson])

  useEffect(() => {
    if (!open) return
    const orders = (presetJson?.prompt_order as Array<Record<string, unknown>> | undefined) ?? []
    const order = orders.find((o) => String(o.character_id) === characterId)
    const entries = (order?.order as Array<Record<string, unknown>> | undefined) ?? []
    setRows(
      entries.map((entry) => {
        const identifier = String(entry.identifier ?? '')
        const meta = promptsById.get(identifier)
        return {
          identifier,
          name: meta?.name ?? identifier,
          role: meta?.role ?? 'system',
          marker: meta?.marker ?? false,
          enabled: entry.enabled === true
        }
      })
    )
  }, [open, presetJson, characterId, promptsById])

  const handleSave = async () => {
    if (!presetJson) return
    setIsSaving(true)
    try {
      // Deep-clone, then rewrite ONLY the chosen order's enabled flags by index
      // (identifiers can repeat in malformed presets; index is unambiguous).
      const next = JSON.parse(JSON.stringify(presetJson)) as Record<string, unknown>
      const orders = (next.prompt_order as Array<Record<string, unknown>> | undefined) ?? []
      const order = orders.find((o) => String(o.character_id) === characterId)
      const entries = (order?.order as Array<Record<string, unknown>> | undefined) ?? []
      entries.forEach((entry, index) => {
        if (rows[index]) entry.enabled = rows[index].enabled
      })
      await onSave(next)
      onOpenChange(false)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.st_assets.entries_save_failed')))
    } finally {
      setIsSaving(false)
    }
  }

  const enabledCount = rows.filter((row) => row.enabled).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>{t('novels.st_assets.entries_toggle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <span className="text-muted-foreground text-xs">
            {t('novels.st_assets.entries_stats', { total: rows.length, enabled: enabledCount })}
          </span>
          <div className="flex max-h-[55vh] flex-col gap-0.5 overflow-y-auto rounded-md border p-2">
            {rows.map((row, index) => (
              <label
                key={`${row.identifier}-${index}`}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                <Checkbox
                  checked={row.enabled}
                  onCheckedChange={(checked) =>
                    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, enabled: checked === true } : r)))
                  }
                />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {row.marker ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {t('novels.st_assets.entries_marker')}
                  </Badge>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{row.role}</span>
                )}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="emphasis" size="sm" loading={isSaving} onClick={handleSave}>
              {t('novels.st_assets.entries_save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default PresetEntryToggleDialog

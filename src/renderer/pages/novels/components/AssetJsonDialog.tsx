import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface AssetJsonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog heading, e.g. the asset's name. */
  title: string
  /** Current JSON of the asset; re-serialized whenever the dialog opens. */
  json: unknown
  /** Status lines shown above the editor (stats / engine warnings). */
  notices?: Array<{ text: string; tone?: 'info' | 'warn' }>
  /** Label for the save button (defaults to the generic "save"). */
  saveLabel?: string
  /** When provided the JSON is editable and saved through this callback. */
  onSave?: (json: unknown) => Promise<void>
}

/**
 * View / edit the raw JSON of an ST asset (preset / worldbook / character
 * card). Editing is plain-text; save re-parses and hands the object to the
 * caller (which persists it through the asset's own endpoint).
 */
const AssetJsonDialog = ({ open, onOpenChange, title, json, notices, saveLabel, onSave }: AssetJsonDialogProps) => {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setText(JSON.stringify(json ?? {}, null, 2))
      setParseError(null)
    }
  }, [open, json])

  const handleSave = async () => {
    if (!onSave) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      setParseError(formatErrorMessageWithPrefix(error, t('novels.asset_json.invalid')))
      return
    }
    setIsSaving(true)
    try {
      await onSave(parsed)
      onOpenChange(false)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.asset_json.save_failed')))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {notices && notices.length > 0 && (
            <div className="flex flex-col gap-1">
              {notices.map((notice, index) => (
                <span
                  key={index}
                  className={notice.tone === 'warn' ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
                  {notice.text}
                </span>
              ))}
            </div>
          )}
          {/* Plain textarea with a fixed height: the ui Textarea auto-grows to
              fit its content (field-sizing-content), which pushes a long JSON
              past the viewport with no way to scroll. */}
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setParseError(null)
            }}
            spellCheck={false}
            className="h-[60vh] w-full resize-none overflow-y-auto rounded-md border border-input bg-transparent px-4 py-3 font-mono text-xs outline-none focus-visible:border-primary"
            readOnly={!onSave}
          />
          {parseError && <span className="text-destructive text-xs">{parseError}</span>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            {onSave && (
              <Button variant="emphasis" size="sm" loading={isSaving} onClick={handleSave}>
                {saveLabel ?? t('novels.asset_json.save')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AssetJsonDialog

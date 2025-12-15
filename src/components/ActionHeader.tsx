"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

type ActionHeaderProps = {
  title: string
  actionLabel: string
  loadingLabel?: string
  onAction: () => void
  disabled?: boolean
  loading?: boolean
}

export function ActionHeader({
  title,
  actionLabel,
  loadingLabel = "Working…",
  onAction,
  disabled,
  loading,
}: ActionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <Button onClick={onAction} disabled={disabled || loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {loadingLabel}
          </>
        ) : (
          actionLabel
        )}
      </Button>
    </div>
  )
}



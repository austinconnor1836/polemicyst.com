"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-dialog-overlay-in data-[state=closed]:animate-dialog-overlay-out motion-reduce:transition-none motion-reduce:animate-none before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:bg-[radial-gradient(1400px_circle_at_50%_30%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.18)_55%,rgba(0,0,0,0.48)_100%)] data-[state=open]:before:animate-dialog-vignette-in data-[state=closed]:before:animate-dialog-vignette-out after:pointer-events-none after:absolute after:inset-0 after:opacity-[0.12] after:mix-blend-overlay after:bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.10)_0px,rgba(255,255,255,0.10)_1px,transparent_1px,transparent_3px),repeating-linear-gradient(90deg,rgba(0,0,0,0.10)_0px,rgba(0,0,0,0.10)_1px,transparent_1px,transparent_4px)] dark:after:opacity-[0.10]",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 w-full max-w-lg max-h-[85vh] translate-x-[-50%] translate-y-[-50%] overflow-y-auto rounded-lg border border-gray-200 bg-[#F9F9F9]/95 p-6 text-[#2E2E2E] outline-none will-change-transform [transform-style:preserve-3d] [perspective:1200px] data-[state=open]:animate-dialog-content-in data-[state=closed]:animate-dialog-content-out motion-reduce:transition-none motion-reduce:animate-none dark:border-zinc-800 dark:bg-[#121212]/92 dark:text-[#E0E0E0] supports-[backdrop-filter:blur(0)]:backdrop-blur-xl supports-[backdrop-filter:blur(0)]:bg-[#F9F9F9]/80 dark:supports-[backdrop-filter:blur(0)]:bg-[#121212]/72 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:opacity-0 before:bg-[radial-gradient(1200px_circle_at_20%_-20%,rgba(255,255,255,0.18),transparent_35%),radial-gradient(900px_circle_at_100%_0%,rgba(255,255,255,0.10),transparent_40%)] data-[state=open]:before:animate-dialog-shine dark:before:bg-[radial-gradient(1200px_circle_at_20%_-20%,rgba(255,255,255,0.10),transparent_40%),radial-gradient(900px_circle_at_100%_0%,rgba(255,255,255,0.06),transparent_45%)] after:pointer-events-none after:absolute after:inset-[-24px] after:-z-10 after:rounded-[calc(theme(borderRadius.lg)+24px)] after:opacity-0 after:blur-2xl after:bg-[radial-gradient(600px_circle_at_50%_0%,rgba(99,102,241,0.22),transparent_60%),radial-gradient(520px_circle_at_0%_100%,rgba(16,185,129,0.18),transparent_55%),radial-gradient(520px_circle_at_100%_100%,rgba(168,85,247,0.18),transparent_55%)] data-[state=open]:after:animate-dialog-halo dark:after:bg-[radial-gradient(600px_circle_at_50%_0%,rgba(99,102,241,0.18),transparent_60%),radial-gradient(520px_circle_at_0%_100%,rgba(16,185,129,0.14),transparent_55%),radial-gradient(520px_circle_at_100%_100%,rgba(168,85,247,0.14),transparent_55%)]",
        className
      )}
      {...props}
    >
      {children}
      <DialogClose className="absolute right-4 top-4 rounded-sm text-[#2E2E2E] opacity-70 ring-offset-[#F9F9F9] transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none dark:text-[#E0E0E0] dark:ring-offset-[#121212]">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogClose>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-gray-500 dark:text-gray-400", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}



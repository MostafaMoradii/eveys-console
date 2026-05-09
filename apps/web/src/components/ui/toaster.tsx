// Minimal toast surface. Built directly on @radix-ui/react-toast.
// One viewport, fixed top-right; queue is held in a local store so any
// component can call `toast({ title, description, variant })` without
// drilling props.

import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type ToastVariant = 'default' | 'destructive';

interface ToastItem {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastContextValue {
  toast: (t: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, ...t }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            onOpenChange={(open) => !open && dismiss(t.id)}
            className={cn(
              'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-4 pr-6 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
              t.variant === 'destructive'
                ? 'border-destructive bg-destructive text-destructive-foreground'
                : 'border bg-background text-foreground',
            )}
          >
            <div className="grid gap-1">
              {t.title ? (
                <ToastPrimitive.Title className="text-sm font-semibold">
                  {t.title}
                </ToastPrimitive.Title>
              ) : null}
              {t.description ? (
                <ToastPrimitive.Description className="text-sm opacity-90">
                  {t.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="Close"
              className="absolute right-2 top-2 rounded-md p-1 opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:max-w-[420px]" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

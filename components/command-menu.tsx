"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { adminNav, MEMBER_NAV, type NavItem } from "@/lib/navigation";
import type { AccessLevel, PageKey } from "@/lib/page-access";

/** Quick search (Ctrl/⌘ + K) to jump to any page or switch the theme. */
export function CommandMenu({ pages }: { pages: Record<PageKey, AccessLevel> }) {
  const adminItems = adminNav(pages);
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const group = (heading: string, items: NavItem[]) => (
    <CommandGroup heading={heading}>
      {items.map((item) => (
        <CommandItem
          key={item.href}
          value={`${heading} ${item.title} ${item.keywords ?? ""}`}
          onSelect={() => run(() => router.push(item.href))}
        >
          <item.icon /> {item.title}
        </CommandItem>
      ))}
    </CommandGroup>
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground h-8 gap-2 px-2.5 font-normal sm:w-48 sm:justify-start"
        aria-label="Search pages"
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="bg-muted ml-auto hidden rounded px-1.5 font-mono text-[10px] font-medium sm:inline">⌘K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Jump to a page or run a quick action</DialogPrimitive.Description>
          <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-item]]:py-2.5">
            <CommandInput placeholder="Where do you want to go?" />
            <CommandList className="max-h-[60vh]">
              <CommandEmpty>Nothing found.</CommandEmpty>
              {adminItems.length > 0 && group("Admin", adminItems)}
              {group(adminItems.length > 0 ? "My space" : "Pages", MEMBER_NAV)}
              <CommandSeparator />
              <CommandGroup heading="Theme">
                <CommandItem value="theme light" onSelect={() => run(() => setTheme("light"))}>
                  <SunIcon /> Light mode
                </CommandItem>
                <CommandItem value="theme dark" onSelect={() => run(() => setTheme("dark"))}>
                  <MoonIcon /> Dark mode
                </CommandItem>
                <CommandItem value="theme system" onSelect={() => run(() => setTheme("system"))}>
                  <MonitorIcon /> Use device setting
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

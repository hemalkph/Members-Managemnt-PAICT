"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type MultiSelectOption = { value: string; label: string; group?: string };

/** Multi-select built from shadcn Popover + Command (searchable, grouped). */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "Nothing found.",
  className,
  id,
  "aria-invalid": ariaInvalid,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = new Set(value);
  const groups = React.useMemo(() => {
    const map = new Map<string, MultiSelectOption[]>();
    for (const option of options) {
      const key = option.group ?? "";
      map.set(key, [...(map.get(key) ?? []), option]);
    }
    return [...map.entries()];
  }, [options]);

  const toggle = (v: string) => {
    onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  const selectedOptions = options.filter((o) => selected.has(o.value));

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={ariaInvalid}
            className="h-auto min-h-10 w-full justify-between font-normal md:min-h-9"
          >
            <span className={cn("truncate", selectedOptions.length === 0 && "text-muted-foreground")}>
              {selectedOptions.length === 0 ? placeholder : `${selectedOptions.length} selected`}
            </span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              {groups.map(([group, items]) => (
                <CommandGroup key={group || "_"} heading={group || undefined}>
                  {items.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.group ?? ""} ${option.label}`}
                      onSelect={() => toggle(option.value)}
                    >
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-[4px] border",
                          selected.has(option.value) ? "bg-primary border-primary text-primary-foreground" : "opacity-60",
                        )}
                      >
                        {selected.has(option.value) && <CheckIcon className="size-3 text-current" />}
                      </span>
                      {option.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((option) => (
            <Badge key={option.value} variant="secondary" className="gap-1 pr-1">
              {option.label}
              <button
                type="button"
                onClick={() => toggle(option.value)}
                className="hover:bg-foreground/10 rounded-sm p-0.5"
                aria-label={`Remove ${option.label}`}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

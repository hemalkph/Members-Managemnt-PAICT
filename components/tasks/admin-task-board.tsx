"use client";

import { useState } from "react";
import { ListTodoIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { TaskView } from "@/lib/task-queries";
import { TaskCard } from "./task-card";
import { TaskDialog, type TaskFormOptions } from "./task-dialog";

/** Admin task list with the create / edit dialog. */
export function AdminTaskBoard({
  tasks,
  options,
  today,
  emptyTitle,
  phones = {},
}: {
  /** Member id → WhatsApp number (wa.me format) for late tasks. */
  phones?: Record<string, string>;
  tasks: TaskView[];
  options: TaskFormOptions;
  today: string;
  emptyTitle: string;
}) {
  const [dialog, setDialog] = useState<{ task: TaskView | null; key: number } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialog({ task: null, key: Date.now() })}>
          <PlusIcon /> Assign a task
        </Button>
      </div>
      {tasks.length === 0 ? (
        <EmptyState icon={ListTodoIcon} title={emptyTitle} description="Assign work with a due date to a member." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              mode="admin"
              whatsapp={phones[t.assigneeId]}
              onEdit={(task) => setDialog({ task, key: Date.now() })}
            />
          ))}
        </div>
      )}
      {dialog && (
        <TaskDialog
          key={dialog.key}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          task={dialog.task}
          options={options}
          today={today}
        />
      )}
    </div>
  );
}

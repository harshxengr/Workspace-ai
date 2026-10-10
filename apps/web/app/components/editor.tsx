"use client";

import { useEffect, useRef, useState } from "react";
import {
  EditorContent,
  useEditor,
} from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

import { apiFetch } from "../lib/api";
import VersionHistory from "./version-history";

type EditorProps = {
  documentId: string;
};

type DocumentResponse = {
  document: {
    id: string;
    title: string;
    content: JSONContent;
  };
};

export default function Editor({
  documentId,
}: EditorProps) {
  const [status, setStatus] = useState("Loading...");
  const [title, setTitle] = useState("");
  const [loaded, setLoaded] = useState(false);

  const saveTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],

    content: {
      type: "doc",
      content: [],
    },

    immediatelyRender: false,

    onUpdate: ({ editor: currentEditor }) => {
      if (!loaded) {
        return;
      }

      setStatus("Saving...");

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(async () => {
        try {
          await apiFetch(
            `/api/documents/${documentId}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                content: currentEditor.getJSON(),
                createVersion: false,
              }),
            },
          );

          setStatus("Saved");
        } catch (error) {
          console.error(
            "Document autosave failed:",
            error,
          );

          setStatus("Save failed");
        }
      }, 800);
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    // Important:
    // Create a stable non-null reference so TypeScript
    // keeps the editor narrowed inside the async function.
    const editorInstance = editor;

    let cancelled = false;

    async function loadDocument() {
      try {
        setStatus("Loading...");

        const result =
          await apiFetch<DocumentResponse>(
            `/api/documents/${documentId}`,
          );

        if (cancelled) {
          return;
        }

        setTitle(result.document.title);

        editorInstance.commands.setContent(
          result.document.content,
        );

        setLoaded(true);
        setStatus("Saved");
      } catch (error) {
        console.error(
          "Document load failed:",
          error,
        );

        if (!cancelled) {
          setStatus("Failed to load");
        }
      }
    }

    void loadDocument();

    return () => {
      cancelled = true;

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [documentId, editor]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, []);

  async function saveTitle() {
    const nextTitle = title.trim();

    if (!nextTitle) {
      setStatus("Title cannot be empty");
      return;
    }

    try {
      setStatus("Saving...");

      await apiFetch(
        `/api/documents/${documentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: nextTitle,
            createVersion: false,
          }),
        },
      );

      setStatus("Saved");
    } catch (error) {
      console.error(
        "Document title save failed:",
        error,
      );

      setStatus("Save failed");
    }
  }

  async function createSnapshot() {
    if (!editor) {
      return;
    }

    try {
      setStatus("Saving snapshot...");

      await apiFetch(
        `/api/documents/${documentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            content: editor.getJSON(),
            createVersion: true,
          }),
        },
      );

      setStatus("Snapshot saved");
    } catch (error) {
      console.error(
        "Document snapshot failed:",
        error,
      );

      setStatus("Snapshot failed");
    }
  }

  function toggleBold() {
    editor?.chain().focus().toggleBold().run();
  }

  function toggleItalic() {
    editor?.chain().focus().toggleItalic().run();
  }

  function toggleHeading(level: 1 | 2) {
    editor
      ?.chain()
      .focus()
      .toggleHeading({ level })
      .run();
  }

  function toggleBulletList() {
    editor
      ?.chain()
      .focus()
      .toggleBulletList()
      .run();
  }

  function toggleOrderedList() {
    editor
      ?.chain()
      .focus()
      .toggleOrderedList()
      .run();
  }

  if (!editor) {
    return (
      <div className="rounded border p-6">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="flex min-h-[700px] overflow-hidden rounded-lg border">
      <div className="min-w-0 flex-1">
        <div className="p-6">
          <input
            value={title}
            onChange={(event) =>
              setTitle(event.target.value)
            }
            onBlur={() => {
              void saveTitle();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            className="mb-4 w-full bg-transparent text-3xl font-bold outline-none"
            placeholder="Untitled document"
          />

          <div className="mb-4 flex flex-wrap items-center gap-2 border-b pb-3">
            <button
              type="button"
              onClick={toggleBold}
              className={`rounded border px-3 py-1 text-sm ${
                editor.isActive("bold")
                  ? "font-bold"
                  : ""
              }`}
            >
              B
            </button>

            <button
              type="button"
              onClick={toggleItalic}
              className={`rounded border px-3 py-1 text-sm ${
                editor.isActive("italic")
                  ? "italic"
                  : ""
              }`}
            >
              I
            </button>

            <button
              type="button"
              onClick={() => toggleHeading(1)}
              className={`rounded border px-3 py-1 text-sm ${
                editor.isActive("heading", {
                  level: 1,
                })
                  ? "font-bold"
                  : ""
              }`}
            >
              H1
            </button>

            <button
              type="button"
              onClick={() => toggleHeading(2)}
              className={`rounded border px-3 py-1 text-sm ${
                editor.isActive("heading", {
                  level: 2,
                })
                  ? "font-bold"
                  : ""
              }`}
            >
              H2
            </button>

            <button
              type="button"
              onClick={toggleBulletList}
              className={`rounded border px-3 py-1 text-sm ${
                editor.isActive("bulletList")
                  ? "font-bold"
                  : ""
              }`}
            >
              List
            </button>

            <button
              type="button"
              onClick={toggleOrderedList}
              className={`rounded border px-3 py-1 text-sm ${
                editor.isActive("orderedList")
                  ? "font-bold"
                  : ""
              }`}
            >
              1.
            </button>

            <button
              type="button"
              onClick={() => {
                void createSnapshot();
              }}
              className="rounded border px-3 py-1 text-sm"
            >
              Snapshot
            </button>

            <span className="ml-auto text-sm">
              {status}
            </span>
          </div>

          <div className="min-h-[550px] rounded border p-5">
            <EditorContent
              editor={editor}
            />
          </div>
        </div>
      </div>

      <VersionHistory
        documentId={documentId}
        onRestore={(content) => {
          editor.commands.setContent(content);
          setStatus("Restored");
        }}
      />
    </div>
  );
}
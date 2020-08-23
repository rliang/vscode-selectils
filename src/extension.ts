import {
  commands,
  window,
  ExtensionContext,
  Selection,
  TextEditor,
  TextEditorEdit,
  QuickPickItem,
} from "vscode";

/**
 * Parses numeric ranges from a string.
 *
 * @param text the text to parse from.
 */
function parseRanges(text: string): [number, number][] {
  return text.split(",").map((str) => {
    const match = str.match(/(\d+)-(\d+)/);
    return [parseInt(match[1]), parseInt(match[2])];
  });
}

/**
 * Parses numbers and ranges of numbers from a string.
 *
 * @param text the text to parse from.
 */
function parseIndices(text: string) {
  const indices = new Set<number>();
  for (const str of text.split(",")) {
    const match = str.match(/(\d+)-(\d+)/);
    if (match) {
      const min = parseInt(match[1]),
        max = parseInt(match[2]);
      for (let i = min; i <= max; i++) indices.add(i);
    } else indices.add(parseInt(str));
  }
  return indices;
}

/**
 * Transforms the the selections of an editor into quick pick items.
 *
 * @param editor the text editor to get the selections from.
 */
function selectionsToQuickPickItems(editor: TextEditor): QuickPickItem[] {
  return editor.selections.map((sel, i) => ({
    label: i.toString(),
    alwaysShow: true,
    description: editor.document.getText(sel).replace(/(\r?\n)+/g, " "),
  }));
}

/**
 * Prompts for text and returns it, while also managing history.
 *
 * @param title the title of the quick pick box.
 * @param prompt the placeholder text for the quick pick box.
 * @param context the context which contains the history.
 * @param historyKey the key of the history within the context.
 */
async function promptText(
  title: string,
  prompt: string,
  context: ExtensionContext,
  historyKey: string
) {
  const box = window.createQuickPick();
  const history = context.globalState.get<string[]>(historyKey) || [];
  box.title = title;
  box.placeholder = prompt;
  box.items = history.map((label) => ({ label }));
  try {
    const text = await new Promise<string>((resolve, reject) => {
      box.onDidAccept(() =>
        box.value.length
          ? resolve(box.value)
          : box.selectedItems.length
            ? resolve(box.selectedItems[0].label)
            : reject()
      );
      box.onDidHide(reject);
      box.show();
    });
    context.globalState.update(historyKey, [
      text,
      ...history.filter((str) => str !== text),
    ]);
    return text;
  } finally {
    box.dispose();
  }
}

/**
 * Prompts for a regular expression and returns it.
 *
 * @param title the title of the quick pick box.
 * @param context the context which contains the history.
 * @param historyKey the key of the history within the context.
 */
async function promptRegexp(
  title: string,
  context: ExtensionContext,
  historyKey: string
) {
  return new RegExp(
    await promptText(title, "Enter a regular expression", context, historyKey),
    "g"
  );
}

/**
 * Prompts for a JS expression and returns a function which evaluates it.
 *
 * @param title the title of the quick pick box.
 * @param context the context which contains the history.
 * @param historyKey the key of the history within the context.
 */
async function promptJS(
  title: string,
  context: ExtensionContext,
  historyKey: string
): Promise<(v: string, i: number, a: string[]) => any> {
  const expr = await promptText(
    title,
    "Enter a JS string (${v}: text, ${i}: index, ${a}: all texts)",
    context,
    historyKey
  );
  return new Function("v", "i", "a", `return \`${expr}\``) as any;
}

/**
 * Prompts for ranges of selections within an editor.
 *
 * @param title the title of the quick pick box.
 * @param editor the editor which contains the selections.
 */
async function promptRanges(title: string, editor: TextEditor) {
  const box = window.createQuickPick();
  box.title = title;
  box.placeholder = "Enter comma-separated ranges (example: 0-2,5-6)";
  box.canSelectMany = true;
  box.items = selectionsToQuickPickItems(editor);
  box.onDidChangeValue((value) => {
    const ranges = parseRanges(value);
    box.selectedItems = box.items.filter((_, i) =>
      ranges.some(([min, max]) => i >= min && i <= max)
    );
  });
  try {
    return parseRanges(
      await new Promise<string>((resolve, reject) => {
        box.onDidAccept(() =>
          box.value.length ? resolve(box.value) : reject()
        );
        box.onDidHide(reject);
        box.show();
      })
    );
  } finally {
    box.dispose();
  }
}

/**
 * Prompts for indices, and ranges of indices, of selections within an editor.
 *
 * @param title the title of the quick pick box.
 * @param editor the editor which contains the selections.
 */
async function promptIndices(title: string, editor: TextEditor) {
  const box = window.createQuickPick();
  box.title = title;
  box.placeholder =
    "Enter comma-separated indices or ranges (example: 0,1,2-3,4)";
  box.canSelectMany = true;
  box.items = selectionsToQuickPickItems(editor);
  box.onDidChangeValue((value) => {
    const indices = parseIndices(value);
    box.selectedItems = box.items.filter((_, i) => indices.has(i));
  });
  try {
    return parseIndices(
      await new Promise<string>((resolve, reject) => {
        box.onDidAccept(() =>
          box.value.length ? resolve(box.value) : reject()
        );
        box.onDidHide(reject);
        box.show();
      })
    );
  } finally {
    box.dispose();
  }
}

export function activate(context: ExtensionContext) {
  for (const [command, handler] of Object.entries({
    async select(editor: TextEditor) {
      const regexp = await promptRegexp("Select", context, "select");
      editor.selections = editor.selections.flatMap((sel) => {
        const offset = editor.document.offsetAt(sel.anchor);
        return [...editor.document.getText(sel).matchAll(regexp)].map(
          (match) =>
            new Selection(
              editor.document.positionAt(offset + match.index),
              editor.document.positionAt(offset + match.index + match[0].length)
            )
        );
      });
    },

    async split(editor: TextEditor) {
      const regexp = await promptRegexp("Split", context, "split");
      editor.selections = editor.selections.flatMap((sel) => {
        const offset = editor.document.offsetAt(sel.anchor);
        let currentOffset = offset;
        const selections: Selection[] = [];
        for (const match of editor.document.getText(sel).matchAll(regexp)) {
          selections.push(
            new Selection(
              editor.document.positionAt(currentOffset),
              editor.document.positionAt(offset + match.index)
            )
          );
          currentOffset = offset + match.index + match[0].length;
        }
        selections.push(
          new Selection(editor.document.positionAt(currentOffset), sel.active)
        );
        return selections;
      });
    },

    async merge(editor: TextEditor) {
      const ranges = await promptRanges("Merge", editor);
      editor.selections = [
        ...ranges.map(
          ([min, max]) =>
            new Selection(
              editor.selections[min].anchor,
              editor.selections[max].active
            )
        ),
        ...editor.selections.filter((_, i) =>
          ranges.every(([min, max]) => i < min || i > max)
        ),
      ];
    },

    async filter(editor: TextEditor) {
      const indices = await promptIndices("Filter", editor);
      editor.selections = editor.selections.filter((_, i) => !indices.has(i));
    },

    async replace(editor: TextEditor) {
      const fn = await promptJS("Replace", context, "replace");
      const texts = editor.selections.map((sel) =>
        editor.document.getText(sel)
      );
      editor.edit((edit) =>
        editor.selections.forEach((sel, i) =>
          edit.replace(sel, fn(texts[i], i, texts))
        )
      );
    },

    swapAnchors(editor: TextEditor) {
      editor.selections = editor.selections.map(
        (sel) => new Selection(sel.active, sel.anchor)
      );
    },

    rotateRight(editor: TextEditor, edit: TextEditorEdit) {
      const texts = editor.selections.map((sel) =>
        editor.document.getText(sel)
      );
      texts.unshift(texts.pop());
      texts.forEach((text, i) => edit.replace(editor.selections[i], text));
    },

    rotateLeft(editor: TextEditor, edit: TextEditorEdit) {
      const texts = editor.selections.map((sel) =>
        editor.document.getText(sel)
      );
      texts.push(texts.shift());
      texts.forEach((text, i) => edit.replace(editor.selections[i], text));
    },
  }))
    context.subscriptions.push(
      commands.registerTextEditorCommand(
        `extension.selectils.${command}`,
        handler
      )
    );
}

export function deactivate() { }
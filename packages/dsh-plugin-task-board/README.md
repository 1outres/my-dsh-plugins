# @1outres/dsh-plugin-task-board

Adds a task board to each DeepSeek Harness project, like a small Trello or
GitHub Projects board. Write cards while the agent works, then send one card to
the agent with `/task`. The agent reads the card, comments on it, and moves it
between columns with the `task_board` tool.

```sh
dsh plugin add @1outres/dsh-plugin-task-board
```

Or install it with every plugin in the repository through the
[`@1outres/dsh-plugins`](../dsh-plugins) bundle. Enable one or the other: both
insert the same `task-board` row.

## Boards

- There is one board for each registered workspace. Open it from **Task board**
  in the sidebar panel list, or from the board button in a session header,
  which opens the board of that session's project.
- A new board has three columns: To do, In progress and Done. You can add,
  rename, reorder and delete columns on each board. A column must be empty
  before you delete it, and a board keeps at least one column.
- Each card has a number in its board (`#12`), a title, a Markdown
  description, comments, and the sessions it was sent to. Drag a card to move
  it to another column or place.

## Sending a card: `/task`

`/task 12` (or `/task #12`) sends card #12 to the agent of the session as a
user message, with its title, column, description and comments. The session
is linked to the card. The command does not move the card; the agent or you
decide when it changes column.

Choosing `/task` from the slash menu without a number opens a list of the
cards of the session's project, grouped by column.

## Agent tool: `task_board`

The tool works on the board of the agent's own project. Its `action` is one
of:

| Action    | What it does                                                    |
| --------- | --------------------------------------------------------------- |
| `list`    | Shows every column and its cards.                               |
| `get`     | Shows one card in full, or without a number the linked cards.   |
| `create`  | Adds a card, in the first column unless `column` names another. |
| `update`  | Changes the title or the description of a card.                 |
| `move`    | Moves a card to another column (column id or title).            |
| `comment` | Adds a comment to a card.                                       |

The agent cannot delete cards or change columns. A subagent sees the cards
linked to its root session.

## Projects and worktrees

The project of a session is the registered workspace that contains its working
directory. When the directory is inside a linked git worktree, the plugin reads
the worktree's `.git` file and its `commondir` and uses the main checkout
instead, so all worktrees of a repository share one board. A directory outside
every registered workspace has no board, and the tool and `/task` report that.

## Storage

Boards and cards live in the durable storage domain `task_board`, tables
`boards` (keyed by the project path) and `cards`. Board changes reach every
open page at once through a Host stream.

## Development

The package is part of [my-dsh-plugins](https://github.com/1outres/my-dsh-plugins).
Its unit tests use fakes and need no running Harness.

## License

MIT

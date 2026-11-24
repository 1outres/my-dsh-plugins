import { useState } from "react"
import type { ProjectPath, ProjectSummary } from "../shared/model"
import { IconButton } from "./IconButton"
import { ChevronDownIcon } from "./icons"
import { Menu } from "./Menu"
import { projectMenuEntries } from "./menus"
import type { Translate } from "./types"

export interface BoardHeaderProps {
  readonly project: ProjectSummary | undefined
  readonly projects: readonly ProjectSummary[]
  readonly loading: boolean
  readonly t: Translate
  readonly onSelect: (project: ProjectPath) => void
}

export function BoardHeader({ project, projects, loading, t, onSelect }: BoardHeaderProps) {
  const [open, setOpen] = useState(false)
  return (
    <header className="tb-header">
      {project === undefined ? (
        loading ? (
          <span className="tb-skeleton tb-skeleton-title" aria-hidden="true" />
        ) : null
      ) : (
        <h1 className="tb-title">{project.title}</h1>
      )}
      {projects.length === 0 ? null : (
        <Menu
          open={open}
          className="tb-menu-wide"
          entries={projectMenuEntries(projects, project?.path)}
          onSelect={(path) => {
            setOpen(false)
            onSelect(path)
          }}
          onClose={() => setOpen(false)}
          anchor={
            <IconButton
              className="tb-switcher"
              label={t("switchProject")}
              expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <ChevronDownIcon />
            </IconButton>
          }
        />
      )}
    </header>
  )
}

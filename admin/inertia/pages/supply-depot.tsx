import { Head } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import {
  IconAlertTriangle,
  IconBox,
  IconBrandDocker,
  IconPackage,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react'
import AppLayout from '~/layouts/AppLayout'
import DynamicIcon, { DynamicIconName } from '~/components/DynamicIcon'
import StyledButton from '~/components/StyledButton'
import StyledModal from '~/components/StyledModal'
import InstallActivityFeed from '~/components/InstallActivityFeed'
import LoadingSpinner from '~/components/LoadingSpinner'
import Alert from '~/components/Alert'
import CustomAppModal from '~/components/CustomAppModal'
import useErrorNotification from '~/hooks/useErrorNotification'
import useServiceInstallationActivity from '~/hooks/useServiceInstallationActivity'
import { ServiceSlim } from '../../types/services'
import { getServiceLink } from '~/lib/navigation'
import api from '~/lib/api'
import { toTitleCase } from '../../app/utils/misc'

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'media', label: 'Media' },
  { id: 'security', label: 'Security' },
  { id: 'networking', label: 'Networking' },
  { id: 'utility', label: 'Utility' },
  { id: 'ai', label: 'AI' },
  { id: 'education', label: 'Education' },
  { id: 'custom', label: 'Custom' },
]

const CATEGORY_COLORS: Record<string, string> = {
  productivity: 'border border-desert-green-light bg-desert-green-lighter text-desert-green-dark',
  media: 'border border-desert-tan-light bg-desert-tan-lighter text-desert-tan-dark',
  security: 'border border-desert-red-light bg-desert-red-lighter text-desert-red-dark',
  networking: 'border border-desert-stone-light bg-desert-stone-lighter text-desert-stone-dark',
  utility: 'border border-desert-olive-light bg-desert-olive-lighter text-desert-olive-dark',
  ai: 'border border-desert-green bg-desert-green-light text-desert-green-darker',
  education: 'border border-desert-orange-light bg-desert-orange-lighter text-desert-orange-dark',
  custom: 'border border-border-subtle bg-surface-secondary text-text-secondary',
}

type Modal =
  | { type: 'install'; service: ServiceSlim }
  | { type: 'start'; service: ServiceSlim }
  | { type: 'stop'; service: ServiceSlim }
  | { type: 'restart'; service: ServiceSlim }
  | { type: 'reinstall'; service: ServiceSlim }
  | { type: 'delete'; service: ServiceSlim }
  | null

export default function SupplyDepotPage(props: { system: { services: ServiceSlim[] } }) {
  const { showError } = useErrorNotification()
  const installActivity = useServiceInstallationActivity()

  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [loading, setLoading] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [customAppOpen, setCustomAppOpen] = useState(false)

  // Preflight state — scoped to the current install modal
  const [preflight, setPreflight] = useState<{
    portConflicts: Array<{ port: number; usedBy: string }>
    resourceWarnings: string[]
  } | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [forceInstall, setForceInstall] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)

  // Auto-reload when installation completes
  useEffect(() => {
    if (!installActivity.length) return
    if (installActivity.some((a) => a.type === 'completed' || a.type === 'update-complete')) {
      setTimeout(() => window.location.reload(), 3000)
    }
  }, [installActivity])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Run preflight when install modal opens
  useEffect(() => {
    if (modal?.type !== 'install') {
      setPreflight(null)
      setForceInstall(false)
      return
    }
    setPreflightLoading(true)
    api
      .preflightCheck(modal.service.service_name)
      .then((res) => {
        if (res) setPreflight(res)
      })
      .catch(() => {}) // non-fatal; proceed without warnings
      .finally(() => setPreflightLoading(false))
  }, [modal])

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filteredServices = props.system.services.filter((s) => {
    if (activeCategory === 'installed' && !s.installed) return false
    if (activeCategory !== 'all' && activeCategory !== 'installed') {
      if (s.category !== activeCategory) return false
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      return (
        s.friendly_name?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.powered_by?.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q)
      )
    }
    return true
  })

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleInstall(service: ServiceSlim) {
    const hasWarnings =
      (preflight?.portConflicts.length ?? 0) > 0 || (preflight?.resourceWarnings.length ?? 0) > 0

    if (hasWarnings && !forceInstall) return

    setLoading(true)
    setModal(null)
    const result = await api.installService(service.service_name)
    setLoading(false)
    if (!result?.success) showError(result?.message || 'Failed to start installation.')
  }

  async function handleAffect(service: ServiceSlim, action: 'start' | 'stop' | 'restart') {
    setModal(null)
    setLoading(true)
    const result = await api.affectService(service.service_name, action)
    setLoading(false)
    if (!result?.success) showError(result?.message || `Failed to ${action} service.`)
    else setTimeout(() => window.location.reload(), 1500)
  }

  async function handleForceReinstall(service: ServiceSlim) {
    setModal(null)
    setLoading(true)
    const result = await api.forceReinstallService(service.service_name)
    setLoading(false)
    if (!result?.success) showError(result?.message || 'Failed to start reinstall.')
  }

  async function handleDelete(service: ServiceSlim) {
    setModal(null)
    setLoading(true)
    const result = await api.deleteCustomApp(service.service_name)
    setLoading(false)
    if (!result?.success) showError(result?.message || 'Failed to delete app.')
    else setTimeout(() => window.location.reload(), 1000)
  }

  function handleCustomAppCreated() {
    setCustomAppOpen(false)
    // Page will reload when installation completes via broadcast
  }

  // ── Install modal helpers ─────────────────────────────────────────────────
  const hasPreflightWarnings =
    (preflight?.portConflicts.length ?? 0) > 0 || (preflight?.resourceWarnings.length ?? 0) > 0

  return (
    <AppLayout>
      <Head title="Supply Depot" />

      {loading && <LoadingSpinner fullscreen text="Working..." />}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <IconBox className="text-desert-green" size={28} />
              Supply Depot
            </h1>
            <p className="text-sm mt-1">
              Browse and install curated apps, or add your own custom apps by providing a Docker image.
            </p>
          </div>
          <StyledButton
            icon="IconBrandDocker"
            variant="outline"
            onClick={() => setCustomAppOpen(true)}
          >
            Add Custom App
          </StyledButton>
        </div>

        {/* Activity feed (shown only while installing) */}
        {installActivity.length > 0 && (
          <div className="mb-6">
            <InstallActivityFeed activity={installActivity} withHeader />
          </div>
        )}

        {/* Search + Category filters */}
        <div className="mb-6 space-y-3">
          <div className="relative">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted h-4 w-4" />
            <input
              type="text"
              placeholder="Search apps..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-md bg-surface-secondary border border-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-desert-green placeholder:text-text-muted/50"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                  activeCategory === cat.id
                    ? 'bg-desert-green text-white'
                    : 'bg-surface-secondary text-text-muted hover:text-text-primary hover:bg-surface-secondary/70'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* App cards */}
        {filteredServices.length === 0 ? (
          <div className="text-center py-16">
            <IconPackage className="mx-auto mb-3 opacity-40" size={48} />
            <p>No apps match your filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredServices.map((service) => (
              <AppCard
                key={service.service_name}
                service={service}
                openDropdown={openDropdown}
                dropdownRef={dropdownRef}
                onOpenDropdown={setOpenDropdown}
                onInstall={() => setModal({ type: 'install', service })}
                onStart={() => setModal({ type: 'start', service })}
                onStop={() => setModal({ type: 'stop', service })}
                onRestart={() => setModal({ type: 'restart', service })}
                onReinstall={() => setModal({ type: 'reinstall', service })}
                onDelete={() => setModal({ type: 'delete', service })}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Install modal */}
      {modal?.type === 'install' && (
        <StyledModal
          title={`Install ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => setModal(null)}
          onConfirm={() => handleInstall(modal.service)}
          confirmText="Install"
          confirmIcon="IconDownload"
          confirmVariant="primary"
          confirmLoading={loading}
        >
          <div className="space-y-3 text-sm text-text-muted">
            <p>
              This will download and start <strong className="text-text-primary">{modal.service.friendly_name}</strong>
              {modal.service.ui_location && (
                <> on port <strong className="text-text-primary">{modal.service.ui_location}</strong></>
              )}.
            </p>
            {modal.service.powered_by && (
              <p className="text-xs">Powered by {modal.service.powered_by}</p>
            )}

            {preflightLoading && (
              <div className="flex items-center gap-2 text-xs text-text-muted py-2">
                <span className="animate-spin inline-block w-3 h-3 border border-desert-green border-t-transparent rounded-full" />
                Checking for conflicts…
              </div>
            )}

            {!preflightLoading && preflight && hasPreflightWarnings && (
              <div className="space-y-2 pt-1">
                {preflight.portConflicts.map((c) => (
                  <Alert
                    key={c.port}
                    type="warning"
                    title={`Port ${c.port} already in use`}
                    message={`Currently bound by: ${c.usedBy}. Installation may fail.`}
                  />
                ))}
                {preflight.resourceWarnings.map((w, i) => (
                  <Alert key={i} type="warning" title="Resource warning" message={w} />
                ))}
                <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
                  <input
                    type="checkbox"
                    checked={forceInstall}
                    onChange={(e) => setForceInstall(e.target.checked)}
                    className="accent-desert-orange h-4 w-4 rounded"
                  />
                  <span className="text-xs text-text-muted">I understand — install anyway</span>
                </label>
              </div>
            )}
          </div>
        </StyledModal>
      )}

      {/* Start modal */}
      {modal?.type === 'start' && (
        <StyledModal
          title={`Start ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => setModal(null)}
          onConfirm={() => handleAffect(modal.service, 'start')}
          confirmText="Start"
          confirmIcon="IconPlayerPlay"
          confirmVariant="primary"
          confirmLoading={loading}
        >
          <p className="text-sm text-text-muted">This will start the container.</p>
        </StyledModal>
      )}

      {/* Stop modal */}
      {modal?.type === 'stop' && (
        <StyledModal
          title={`Stop ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => setModal(null)}
          onConfirm={() => handleAffect(modal.service, 'stop')}
          confirmText="Stop"
          confirmIcon="IconPlayerStop"
          confirmVariant="action"
          confirmLoading={loading}
        >
          <p className="text-sm text-text-muted">The container will be stopped. Your data is preserved.</p>
        </StyledModal>
      )}

      {/* Restart modal */}
      {modal?.type === 'restart' && (
        <StyledModal
          title={`Restart ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => setModal(null)}
          onConfirm={() => handleAffect(modal.service, 'restart')}
          confirmText="Restart"
          confirmIcon="IconRefresh"
          confirmVariant="action"
          confirmLoading={loading}
        >
          <p className="text-sm text-text-muted">The container will be briefly stopped and restarted.</p>
        </StyledModal>
      )}

      {/* Force reinstall modal */}
      {modal?.type === 'reinstall' && (
        <StyledModal
          title={`Force Reinstall ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => setModal(null)}
          onConfirm={() => handleForceReinstall(modal.service)}
          confirmText="Wipe & Reinstall"
          confirmIcon="IconRefresh"
          confirmVariant="danger"
          confirmLoading={loading}
          icon={<IconAlertTriangle className="text-desert-red" size={40} />}
        >
          <div className="space-y-2 text-sm text-text-muted">
            <p className="font-semibold text-desert-red">This will delete all app data and cannot be undone.</p>
            <p>The container and its associated volumes will be removed, then a fresh installation will begin.</p>
          </div>
        </StyledModal>
      )}

      {/* Delete custom app modal */}
      {modal?.type === 'delete' && (
        <StyledModal
          title={`Delete ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => setModal(null)}
          onConfirm={() => handleDelete(modal.service)}
          confirmText="Delete"
          confirmIcon="IconTrash"
          confirmVariant="danger"
          confirmLoading={loading}
          icon={<IconAlertTriangle className="text-desert-red" size={40} />}
        >
          <div className="space-y-2 text-sm text-text-muted">
            <p className="font-semibold text-desert-red">This will permanently remove this custom app.</p>
            <p>The container will be stopped and removed. Host volume data will remain on disk.</p>
          </div>
        </StyledModal>
      )}

      {/* Custom app creation modal */}
      <CustomAppModal
        open={customAppOpen}
        onClose={() => setCustomAppOpen(false)}
        onCreated={handleCustomAppCreated}
        showError={showError}
      />
    </AppLayout>
  )
}

// ── App Card component ────────────────────────────────────────────────────────

interface AppCardProps {
  service: ServiceSlim
  openDropdown: string | null
  dropdownRef: React.RefObject<HTMLDivElement | null>
  onOpenDropdown: (name: string | null) => void
  onInstall: () => void
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onReinstall: () => void
  onDelete: () => void
}

function AppCard({
  service,
  openDropdown,
  dropdownRef,
  onOpenDropdown,
  onInstall,
  onStart,
  onStop,
  onRestart,
  onReinstall,
  onDelete,
}: AppCardProps) {
  const isRunning = service.status === 'running'
  const isStopped = service.installed && !isRunning
  const catColor = service.category ? CATEGORY_COLORS[service.category] ?? CATEGORY_COLORS.custom : CATEGORY_COLORS.custom
  const isDropdownOpen = openDropdown === service.service_name

  function toggleDropdown(e: React.MouseEvent) {
    e.stopPropagation()
    onOpenDropdown(isDropdownOpen ? null : service.service_name)
  }

  return (
    <div
      className={`relative flex flex-col rounded-xl border p-4 bg-surface-primary transition-all ${
        service.installed
          ? 'border-desert-green/40 hover:border-desert-green/70'
          : 'border-surface-secondary hover:border-desert-green/30'
      }`}
    >
      {/* Top row: icon + status badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0">
            {service.icon ? (
              <DynamicIcon icon={service.icon as DynamicIconName} className="h-7 w-7 text-desert-green" />
            ) : (
              <IconBrandDocker className="h-7 w-7 text-text-muted" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary text-sm leading-tight truncate">
              {service.friendly_name ?? service.service_name}
            </p>
            {service.powered_by && (
              <p className="text-xs text-text-muted truncate">{service.powered_by}</p>
            )}
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex-shrink-0 ml-2">
          {service.installation_status === 'installing' ? (
            <span className="flex items-center gap-1 text-xs text-desert-orange">
              <span className="animate-spin inline-block w-3 h-3 border border-desert-orange border-t-transparent rounded-full" />
              Installing
            </span>
          ) : isRunning ? (
            <span className="flex items-center gap-1 text-xs text-desert-green">
              <span className="h-2 w-2 rounded-full bg-desert-green" />
              Running
            </span>
          ) : isStopped ? (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <span className="h-2 w-2 rounded-full bg-text-muted" />
              Stopped
            </span>
          ) : null}
        </div>
      </div>

      {/* Description */}
      {service.description && (
        <p className="text-xs text-text-muted leading-relaxed mb-3 flex-1 line-clamp-2">
          {service.description}
        </p>
      )}

      {/* Metadata row: category badge + port pill */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {service.category && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catColor}`}>
            {toTitleCase(service.category)}
          </span>
        )}
        {service.is_custom ? (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-surface-secondary text-text-muted border border-surface-secondary">
            custom
          </span>
        ) : null}
        {service.ui_location && !service.ui_location.startsWith('/') && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-secondary text-text-muted font-mono">
            :{service.ui_location}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {!service.installed && service.installation_status !== 'installing' && (
          <StyledButton
            size="sm"
            variant="primary"
            icon="IconDownload"
            onClick={onInstall}
            fullWidth
          >
            Install
          </StyledButton>
        )}

        {service.installed ? (
          <>
            {/* Open button */}
            {service.ui_location && (
              <a
                href={getServiceLink(service.ui_location)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1"
              >
                <StyledButton size="sm" variant="primary" icon="IconExternalLink" fullWidth>
                  Open
                </StyledButton>
              </a>
            )}

            {/* Manage dropdown */}
            <div className="relative" ref={isDropdownOpen ? dropdownRef : null}>
              <StyledButton size="sm" variant="outline" onClick={toggleDropdown} icon="IconChevronDown">
                Manage
              </StyledButton>

              {isDropdownOpen && (
                <div className="absolute right-0 bottom-full mb-1 w-44 bg-surface-primary border border-surface-secondary rounded-lg shadow-xl z-20 overflow-hidden">
                  {isStopped && (
                    <DropdownItem icon={<IconPlayerPlay className="h-4 w-4" />} label="Start" onClick={onStart} />
                  )}
                  {isRunning && (
                    <DropdownItem icon={<IconPlayerStop className="h-4 w-4" />} label="Stop" onClick={onStop} />
                  )}
                  <DropdownItem icon={<IconRefresh className="h-4 w-4" />} label="Restart" onClick={onRestart} />
                  <DropdownItem icon={<IconRefresh className="h-4 w-4 text-desert-orange" />} label="Force Reinstall" onClick={onReinstall} danger />
                  {service.is_custom ? (
                    <DropdownItem icon={<IconTrash className="h-4 w-4 text-desert-red" />} label="Delete" onClick={onDelete} danger />
                  ): null}
                </div>
              )}
            </div>
          </>
        ) : null}

        {service.installation_status === 'installing' && (
          <div className="flex-1 flex items-center justify-center text-xs text-text-muted gap-1 py-1">
            <span className="animate-spin inline-block w-3 h-3 border border-desert-green border-t-transparent rounded-full" />
            In progress…
          </div>
        )}
      </div>
    </div>
  )
}

function DropdownItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors text-left cursor-pointer ${
        danger
          ? 'text-desert-red hover:bg-desert-red/10'
          : 'text-text-primary hover:bg-surface-secondary'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

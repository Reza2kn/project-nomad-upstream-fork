import { DockerService } from '#services/docker_service';
import { SystemService } from '#services/system_service'
import { SystemUpdateService } from '#services/system_update_service'
import { ContainerRegistryService } from '#services/container_registry_service'
import { CheckServiceUpdatesJob } from '#jobs/check_service_updates_job'
import {
  affectServiceValidator,
  checkLatestVersionValidator,
  customAppValidator,
  deleteCustomAppValidator,
  installServiceValidator,
  preflightValidator,
  subscribeToReleaseNotesValidator,
  updateServiceValidator,
} from '#validators/system'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Service from '#models/service'

@inject()
export default class SystemController {
    constructor(
        private systemService: SystemService,
        private dockerService: DockerService,
        private systemUpdateService: SystemUpdateService,
        private containerRegistryService: ContainerRegistryService
    ) { }

    async getInternetStatus({ }: HttpContext) {
        return await this.systemService.getInternetStatus();
    }

    async getSystemInfo({ }: HttpContext) {
        return await this.systemService.getSystemInfo();
    }

    async getServices({ }: HttpContext) {
        return await this.systemService.getServices({ installedOnly: true });
    }

    async installService({ request, response }: HttpContext) {
        const payload = await request.validateUsing(installServiceValidator);

        const result = await this.dockerService.createContainerPreflight(payload.service_name);
        if (result.success) {
            response.send({ success: true, message: result.message });
        } else {
            response.status(400).send({ success: false, message: result.message });
        }
    }

    async affectService({ request, response }: HttpContext) {
        const payload = await request.validateUsing(affectServiceValidator);
        const result = await this.dockerService.affectContainer(payload.service_name, payload.action);
        if (!result) {
            response.internalServerError({ error: 'Failed to affect service' });
            return;
        }
        response.send({ success: result.success, message: result.message });
    }

    async checkLatestVersion({ request }: HttpContext) {
        const payload = await request.validateUsing(checkLatestVersionValidator)
        return await this.systemService.checkLatestVersion(payload.force);
    }

    async forceReinstallService({ request, response }: HttpContext) {
        const payload = await request.validateUsing(installServiceValidator);
        const result = await this.dockerService.forceReinstall(payload.service_name);
        if (!result) {
            response.internalServerError({ error: 'Failed to force reinstall service' });
            return;
        }
        response.send({ success: result.success, message: result.message });
    }

    async requestSystemUpdate({ response }: HttpContext) {
        if (!this.systemUpdateService.isSidecarAvailable()) {
            response.status(503).send({
                success: false,
                error: 'Update sidecar is not available. Ensure the updater container is running.',
            });
            return;
        }

        const result = await this.systemUpdateService.requestUpdate();

        if (result.success) {
            response.send({
                success: true,
                message: result.message,
                note: 'Monitor update progress via GET /api/system/update/status. The connection may drop during container restart.',
            });
        } else {
            response.status(409).send({
                success: false,
                error: result.message,
            });
        }
    }

    async getSystemUpdateStatus({ response }: HttpContext) {
        const status = this.systemUpdateService.getUpdateStatus();

        if (!status) {
            response.status(500).send({
                error: 'Failed to retrieve update status',
            });
            return;
        }

        response.send(status);
    }

    async getSystemUpdateLogs({ response }: HttpContext) {
        const logs = this.systemUpdateService.getUpdateLogs();
        response.send({ logs });
    }


    async subscribeToReleaseNotes({ request }: HttpContext) {
        const reqData = await request.validateUsing(subscribeToReleaseNotesValidator);
        return await this.systemService.subscribeToReleaseNotes(reqData.email);
    }

    async getDebugInfo({}: HttpContext) {
        const debugInfo = await this.systemService.getDebugInfo()
        return { debugInfo }
    }

    async checkServiceUpdates({ response }: HttpContext) {
        await CheckServiceUpdatesJob.dispatch()
        response.send({ success: true, message: 'Service update check dispatched' })
    }

    async getAvailableVersions({ params, response }: HttpContext) {
        const serviceName = params.name
        const service = await (await import('#models/service')).default
            .query()
            .where('service_name', serviceName)
            .where('installed', true)
            .first()

        if (!service) {
            return response.status(404).send({ error: `Service ${serviceName} not found or not installed` })
        }

        try {
            const hostArch = await this.getHostArch()
            const updates = await this.containerRegistryService.getAvailableUpdates(
                service.container_image,
                hostArch,
                service.source_repo
            )
            response.send({ versions: updates })
        } catch (error) {
            logger.error({ err: error }, `[SystemController] Failed to fetch versions for ${serviceName}`)
            response.status(500).send({ error: 'Failed to fetch available versions for this service.' })
        }
    }

    async updateService({ request, response }: HttpContext) {
        const payload = await request.validateUsing(updateServiceValidator)
        const result = await this.dockerService.updateContainer(
            payload.service_name,
            payload.target_version
        )

        if (result.success) {
            response.send({ success: true, message: result.message })
        } else {
            response.status(400).send({ error: result.message })
        }
    }

    private async getHostArch(): Promise<string> {
        try {
            const info = await this.dockerService.docker.info()
            const arch = info.Architecture || ''
            const archMap: Record<string, string> = {
                x86_64: 'amd64',
                aarch64: 'arm64',
                armv7l: 'arm',
                amd64: 'amd64',
                arm64: 'arm64',
            }
            return archMap[arch] || arch.toLowerCase()
        } catch {
            return 'amd64'
        }
    }

    /**
     * Pre-install preflight check: reports port conflicts and resource warnings for a service.
     * Results are advisory — the UI shows warnings but allows the user to force-proceed.
     */
    async preflightCheck({ request, response }: HttpContext) {
        const payload = await request.validateUsing(preflightValidator)

        const service = await Service.query().where('service_name', payload.service_name).first()
        if (!service) {
            return response.status(404).send({ error: `Service ${payload.service_name} not found` })
        }

        // Extract host ports from container_config — the MySQL driver may return JSON columns
        // as an already-parsed object rather than a string, so guard before calling JSON.parse.
        const rawConfig = service.container_config
        const config = rawConfig
            ? typeof rawConfig === 'object'
                ? rawConfig
                : JSON.parse(rawConfig as string)
            : null
        const portBindings: Record<string, [{ HostPort: string }]> =
            config?.HostConfig?.PortBindings ?? {}
        const hostPorts = Object.values(portBindings)
            .flat()
            .map((b) => parseInt(b.HostPort, 10))
            .filter((p) => !isNaN(p))

        // Parse resource requirements from metadata (same object-guard as container_config)
        let minMemoryMB = 256
        let minDiskMB = 512
        try {
            const rawMeta = service.metadata
            const meta = rawMeta
                ? typeof rawMeta === 'object'
                    ? rawMeta
                    : JSON.parse(rawMeta as string)
                : null
            if (meta?.minMemoryMB) minMemoryMB = meta.minMemoryMB
            if (meta?.minDiskMB) minDiskMB = meta.minDiskMB
        } catch {}

        const [{ conflicts: portConflicts }, resourceWarnings] = await Promise.all([
            this.dockerService.checkPortConflicts(hostPorts),
            this.systemService.checkResourceWarnings(minMemoryMB, minDiskMB),
        ])

        return response.send({ portConflicts, resourceWarnings })
    }

    /** Return the next suggested host port for a custom app (8600+ range). */
    async suggestCustomPort({ response }: HttpContext) {
        const port = await this.systemService.getNextSuggestedCustomPort()
        return response.send({ port })
    }

    /** Create and immediately begin installing a custom app container. */
    async createCustomApp({ request, response }: HttpContext) {
        const payload = await request.validateUsing(customAppValidator)

        // Derive a stable service_name from the friendly name
        const slug = payload.friendly_name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
        const serviceName = `nomad_custom_${slug}`

        const existing = await Service.query().where('service_name', serviceName).first()
        if (existing) {
            return response.status(409).send({
                success: false,
                message: `A custom app named "${payload.friendly_name}" already exists. Choose a different name.`,
            })
        }

        // Build PortBindings and ExposedPorts from user-supplied port mappings
        const portBindings: Record<string, [{ HostPort: string }]> = {}
        const exposedPorts: Record<string, {}> = {}
        for (const { container, host } of payload.ports ?? []) {
            portBindings[`${container}/tcp`] = [{ HostPort: String(host) }]
            exposedPorts[`${container}/tcp`] = {}
        }

        const binds = (payload.volumes ?? []).map(
            ({ host_path, container_path }) => `${host_path}:${container_path}`
        )

        const containerConfig: Record<string, any> = {
            HostConfig: {
                RestartPolicy: { Name: 'unless-stopped' },
                PortBindings: portBindings,
                ...(binds.length ? { Binds: binds } : {}),
            },
            ExposedPorts: exposedPorts,
            ...(payload.env?.length ? { Env: payload.env } : {}),
        }

        // Pick ui_location from the first mapped host port
        const firstHostPort = payload.ports?.[0]?.host
        const uiLocation = firstHostPort ? String(firstHostPort) : null

        await Service.create({
            service_name: serviceName,
            friendly_name: payload.friendly_name,
            container_image: payload.image,
            container_config: JSON.stringify(containerConfig),
            ui_location: uiLocation,
            icon: 'IconBrandDocker',
            installed: false,
            installation_status: 'idle',
            is_dependency_service: false,
            is_custom: true,
            category: payload.category ?? 'custom',
            depends_on: null,
        })

        const result = await this.dockerService.createContainerPreflight(serviceName)
        if (result.success) {
            return response.send({ success: true, message: result.message, service_name: serviceName })
        }
        return response.status(400).send({ success: false, message: result.message })
    }

    /** Delete a custom app: stop + remove its container, then delete the DB record. */
    async deleteCustomApp({ request, response }: HttpContext) {
        const payload = await request.validateUsing(deleteCustomAppValidator)

        const service = await Service.query().where('service_name', payload.service_name).first()
        if (!service) {
            return response.status(404).send({ error: `Service ${payload.service_name} not found` })
        }
        if (!service.is_custom) {
            return response.status(403).send({ error: 'Only custom apps can be deleted.' })
        }

        await this.dockerService.removeCustomAppContainer(payload.service_name)
        await service.delete()

        return response.send({ success: true, message: `Custom app ${payload.service_name} deleted` })
    }
}
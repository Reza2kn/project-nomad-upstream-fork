import vine from '@vinejs/vine'

export const installServiceValidator = vine.compile(
  vine.object({
    service_name: vine.string().trim(),
  })
)

export const affectServiceValidator = vine.compile(
  vine.object({
    service_name: vine.string().trim(),
    action: vine.enum(['start', 'stop', 'restart']),
  })
)

export const subscribeToReleaseNotesValidator = vine.compile(
  vine.object({
    email: vine.string().email().trim(),
  })
)

export const checkLatestVersionValidator = vine.compile(
  vine.object({
    force: vine.boolean().optional(), // Optional flag to force bypassing cache and checking for updates immediately
  })
)

export const updateServiceValidator = vine.compile(
  vine.object({
    service_name: vine.string().trim(),
    target_version: vine.string().trim(),
  })
)

export const preflightValidator = vine.compile(
  vine.object({
    service_name: vine.string().trim(),
  })
)

export const customAppValidator = vine.compile(
  vine.object({
    friendly_name: vine.string().trim().minLength(1).maxLength(100),
    image: vine.string().trim().minLength(1),
    ports: vine
      .array(
        vine.object({
          container: vine.number().min(1).max(65535),
          host: vine.number().min(1024).max(65535),
        })
      )
      .optional(),
    volumes: vine
      .array(
        vine.object({
          host_path: vine.string().trim(),
          container_path: vine.string().trim(),
        })
      )
      .optional(),
    env: vine.array(vine.string().trim()).optional(),
    category: vine
      .enum(['productivity', 'media', 'security', 'networking', 'utility', 'ai', 'education', 'custom'])
      .optional(),
  })
)

export const deleteCustomAppValidator = vine.compile(
  vine.object({
    service_name: vine.string().trim(),
  })
)

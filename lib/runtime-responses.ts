import { getAdminConfig, type AdminConfig } from './admin-config';

export type ResponseTemplateKey = keyof AdminConfig['responseTemplates'];

export function renderResponseTemplate(template: string, variables: Record<string, string | number> = {}) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}

export async function getRuntimeResponse(
  key: ResponseTemplateKey,
  variables: Record<string, string | number> = {},
) {
  const config = await getAdminConfig();
  return renderResponseTemplate(config.responseTemplates[key], variables);
}

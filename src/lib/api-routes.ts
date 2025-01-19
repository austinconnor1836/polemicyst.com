export enum ApiRoutes {
    CHAT_GPT = '/ai',
}

export function buildApiRoute(route: ApiRoutes) {
    return `/api/${route}`;
}
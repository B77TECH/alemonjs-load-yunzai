import type { YunzaiVariant } from './variant';

const adaptedConfigs = new WeakSet<object>();

/** Adapt legacy single-group APIs only; TRSS already accepts (botId, groupId). */
export function installConfigCompatibility(cfg: any, variant: YunzaiVariant, warn: (message: string) => void): boolean {
  if (!cfg || typeof cfg.getGroup !== 'function') {
    return false;
  }
  if (variant === 'trss' || adaptedConfigs.has(cfg)) {
    return true;
  }
  // Default parameters make Function.length unreliable. Unknown forks retain
  // their native API rather than silently losing arguments.
  if (variant !== 'miao' && variant !== 'yunzai') {
    warn('[compat] 未识别群配置接口，保留原生 cfg.getGroup');
    return false;
  }

  try {
    const getGroup = cfg.getGroup;

    cfg.getGroup = function (this: any, ...args: any[]) {
      return Reflect.apply(getGroup, this, args.length >= 2 ? [args[1], ...args.slice(2)] : args);
    };
    adaptedConfigs.add(cfg);
    return true;
  } catch {
    warn('[compat] cfg.getGroup 不可注入双参数兼容');
    return false;
  }
}

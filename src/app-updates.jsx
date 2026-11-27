import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {version} from '../package.json';
import {api} from './api';

const checkInterval = 6 * 60 * 60 * 1000;
export const projectUrl = 'https://github.com/ZikQ-Shmily/GlassMail';

export function useAppUpdates() {
  const [result,setResult] = useState(null);
  const [checking,setChecking] = useState(false);
  const [opening,setOpening] = useState(false);
  const [error,setError] = useState('');
  const inFlight = useRef(false);

  const check = useCallback(async (manual = false) => {
    if (!api.desktop || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    if (manual) setError('');
    try {
      setResult(await api.checkUpdate());
      setError('');
    } catch (cause) {
      if (manual) setError(updateError(cause));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, []);

  const download = async () => {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      await api.openUpdate();
    } catch (cause) {
      setError(updateError(cause));
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    if (!api.desktop) return;
    void check();
    const timer = setInterval(() => void check(), checkInterval);
    return () => clearInterval(timer);
  }, [check]);

  return {result,checking,opening,error,check,download};
}

function updateError(cause) {
  return cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function UpdateCard({updates}) {
  const {result,checking,opening,error,check,download} = updates;
  const available = result?.status === 'available';
  let status = '检查 GitHub 上的新版本。';
  if (!api.desktop) status = '请在桌面应用中检查更新。';
  else if (checking) status = '正在检查更新…';
  else if (available) status = `GlassMail ${result.latestVersion} 已发布，下载后打开安装包即可更新。`;
  else if (result?.status === 'current') status = '当前已是最新版本。';
  else if (result?.status === 'unavailable') status = result.latestVersion
    ? `新版本 ${result.latestVersion} 暂无适用于此设备的安装包。`
    : '此设备暂无可用的安装包。';

  return <section className="glass settings-card software-update" aria-labelledby="software-update-title">
    <div className="update-heading">
      <h2 id="software-update-title">软件更新</h2>
      <span className="update-version">v{result?.currentVersion || version}</span>
    </div>
    <p role="status">{status}</p>
    {error&&<p className="update-error" role="alert">{error}</p>}
    <div className="update-actions">
      {available&&<button className="button primary" disabled={opening} onClick={download}>
        <Download size={15}/>{opening?'正在打开…':'下载更新'}
      </button>}
      <button className="button secondary" disabled={!api.desktop||checking} onClick={()=>void check(true)}>
        <RefreshCw size={15} className={checking?'spin':''}/>{checking?'检查中…':'检查更新'}
      </button>
    </div>
  </section>;
}

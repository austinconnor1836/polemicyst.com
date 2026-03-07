import { usePlatformContext } from './PlatformContext';
import { ActionHeader } from '@/components/ActionHeader';

const Header = () => {
  const { activeVideo, generateDescription, isGenerating } = usePlatformContext();

  return (
    <ActionHeader
      title="Post a Video"
      actionLabel="Regenerate AI Description"
      loadingLabel="Generating..."
      onAction={() => activeVideo && generateDescription(activeVideo.id)}
      disabled={!activeVideo}
      loading={isGenerating}
    />
  );
};

export default Header;

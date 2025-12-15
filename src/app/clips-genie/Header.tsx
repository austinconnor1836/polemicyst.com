import { usePlatformContext } from "./PlatformContext";
import { ActionHeader } from "@/components/ActionHeader";


const Header = () => {
    const { selectedFile, generateDescription, isGenerating } = usePlatformContext();

    return (
        <ActionHeader
            title="Post a Video"
            actionLabel="Regenerate AI Description"
            loadingLabel="Generating..."
            onAction={() => selectedFile && generateDescription(selectedFile)}
            disabled={!selectedFile}
            loading={isGenerating}
        />
    )
};

export default Header;
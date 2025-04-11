import { usePlatformContext } from "./PlatformContext";


const Header = () => {
    const { selectedFile, generateDescription, isGenerating } = usePlatformContext();

    return (
        <div className="flex justify-between items-center">
            <h2 className="text-2xl font-semibold">Post a Video</h2>
            <button
                className="bg-blue-500 text-white px-3 py-1 rounded-md transition hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                onClick={() => selectedFile && generateDescription(selectedFile)}
                disabled={!selectedFile || isGenerating}
            >
                {isGenerating ? 'Generating...' : 'Regenerate AI Description'}
            </button>
        </div>
    )
};

export default Header;
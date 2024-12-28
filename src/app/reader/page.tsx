'use client';
import { useState } from 'react';
import './styles.css';

export default function Home() {
    const [content, setContent] = useState('');
    const [isPasteSectionVisible, setIsPasteSectionVisible] = useState(true);

    const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const pastedText = event.clipboardData.getData('text');
        setContent(pastedText);
    };

    const togglePasteSection = () => {
        setIsPasteSectionVisible(!isPasteSectionVisible);
    };

    return (
        <div className="container">
            <button onClick={togglePasteSection} className="toggle-button">
                {isPasteSectionVisible ? 'Hide' : 'Show'} Paste Section
            </button>
            {isPasteSectionVisible && (
                <div className="paste-section">
                    <h1>Paste Your Text Here</h1>
                    <textarea
                        className="textarea"
                        placeholder="Paste your text here..."
                        onPaste={handlePaste}
                        rows={10}
                        cols={50}
                    />
                </div>
            )}
            <h2>Content:</h2>
            <pre>{content}</pre>
        </div>
    );
}
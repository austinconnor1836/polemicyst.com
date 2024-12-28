import React, { useState } from 'react';

interface PostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newStory: any) => void;
}

const PostModal: React.FC<PostModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'link' | 'video'>('link');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handlePostSubmit = async () => {
    const newStory = {
      id: Date.now().toString(),
      url,
      description: type === 'link' ? 'Link' : 'Video',
      tags: ["healthcare horror"],
      upvotes: 0,
      createdAt: new Date().toISOString(),
    };

    try {
      setIsLoading(true);
      const response = await fetch('http://localhost:3000/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          description: newStory.description,
          tags: newStory.tags,
        }),
      });

      const responseData = await response.json();

      if (response.ok && responseData._id) {
        onSuccess(responseData);
        setStatus('success');
      } else {
        console.error('Error posting story:', response.statusText);
        setStatus('error');
      }
    } catch (error) {
      console.error('Error posting story:', error);
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setType('link');
    setIsLoading(false);
    setStatus('idle');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white p-4 rounded shadow-md w-96">
        {status === 'idle' && (
          <>
            <h2 className="text-xl mb-4">Post a Link or Video</h2>
            <div className="mb-4">
              <label className="block mb-2">Type:</label>
              <select value={type} onChange={(e) => setType(e.target.value as 'link' | 'video')} className="p-2 border rounded w-full">
                <option value="link">Link</option>
                <option value="video">Video</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block mb-2">URL:</label>
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} className="p-2 border rounded w-full" />
            </div>
            <div className="flex justify-end">
              <button onClick={handleClose} className="mr-2 p-2 bg-gray-300 rounded">Cancel</button>
              <button onClick={handlePostSubmit} className="p-2 bg-blue-500 text-white rounded">Submit</button>
            </div>
          </>
        )}
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4"></div>
            <p>Loading...</p>
          </div>
        )}
        {status === 'success' && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="text-green-500 text-4xl mb-4">✔</div>
            <p>Success</p>
            <button onClick={handleClose} className="mt-4 p-2 bg-green-500 text-white rounded">Close</button>
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="text-red-500 text-4xl mb-4">✖</div>
            <p>Failed</p>
            <button onClick={handleClose} className="mt-4 p-2 bg-red-500 text-white rounded">Close</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PostModal;
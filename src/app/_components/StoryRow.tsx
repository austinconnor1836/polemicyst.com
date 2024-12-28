import React, { useState } from 'react';
import DeleteModal from './DeleteModal';
import { useStories } from '../context/StoriesContext';

interface StoryRowProps {
  id: string;
  url: string;
  description: string;
  tags: string[];
  upvotes: number;
}

const StoryRow: React.FC<StoryRowProps> = ({ id, url, description, tags, upvotes }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [currentUpvotes, setCurrentUpvotes] = useState(upvotes);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const { deleteStory } = useStories();

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleUpvote = () => {
    setCurrentUpvotes(currentUpvotes + 1);
  };

  const handleDelete = () => {
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = (deletedLink: any) => {
    console.log('Deleted link:', deletedLink);
    deleteStory(id);
  };

  return (
    <div className="p-4 bg-white rounded shadow-md mb-2 w-full max-w-4xl">
      <div className="flex justify-between items-center">
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500">
          {description}
        </a>
        <div className="flex items-center">
          <button onClick={toggleCollapse} className="text-sm text-gray-500 mr-2">
            {isCollapsed ? (
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 9l-7 7-7-7"
                ></path>
              </svg>
            ) : (
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 15l7-7 7 7"
                ></path>
              </svg>
            )}
          </button>
          <button onClick={handleDelete} className="text-sm text-red-500">
            <svg
              className="w-8 h-8"
              fill="red"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="12" cy="12" r="10" fill="red" />
              <path
                fill="none"
                stroke="white"
                strokeWidth="2"
                d="M8 8l8 8M8 16l8-8"
              />
            </svg>
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <div className="mt-2">
          <div>
            {tags.map((tag, index) => (
              <span key={index} className="text-xs text-gray-500 mr-2">
                #{tag}
              </span>
            ))}
          </div>
          {description === 'Video' ? (
            <iframe
              src={url}
              className="w-full h-64 mt-2"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            ></iframe>
          ) : (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 mt-2 block">
              {url}
            </a>
          )}
          <button onClick={handleUpvote} className="mt-2 text-sm text-green-500">
            Upvote ({currentUpvotes})
          </button>
        </div>
      )}
      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        id={id}
      />
    </div>
  );
};

export default StoryRow;
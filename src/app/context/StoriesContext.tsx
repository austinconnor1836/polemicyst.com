import React, { createContext, useContext, useState, ReactNode } from 'react';

interface Story {
  _id: string;
  url: string;
  description: string;
  tags: string[];
  upvotes: number;
  createdAt: string;
}

interface StoriesContextProps {
  stories: Story[];
  setStories: (stories: Story[]) => void;
  addStory: (story: Story) => void;
  deleteStory: (id: string) => void;
}

const StoriesContext = createContext<StoriesContextProps | undefined>(undefined);

export const useStories = () => {
  const context = useContext(StoriesContext);
  if (!context) {
    throw new Error('useStories must be used within a StoriesProvider');
  }
  return context;
};

export const StoriesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [stories, setStoriesState] = useState<Story[]>([]);

  const setStories = (stories: Story[]) => {
    setStoriesState(stories);
  };

  const addStory = (story: Story) => {
    setStoriesState((prevStories) => [story, ...prevStories]);
  };

  const deleteStory = (id: string) => {
    setStoriesState((prevStories) => prevStories.filter((story) => story._id !== id));
  };

  return (
    <StoriesContext.Provider value={{ stories, setStories, addStory, deleteStory }}>
      {children}
    </StoriesContext.Provider>
  );
};
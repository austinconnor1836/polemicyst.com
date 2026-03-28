type Props = {
  children?: React.ReactNode;
};

const Container = ({ children }: Props) => {
  return <div className="container mx-auto px-5 max-w-full overflow-x-hidden">{children}</div>;
};

export default Container;

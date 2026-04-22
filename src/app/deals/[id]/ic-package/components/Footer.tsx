interface Props {
  dealCode: string;
  brandLeft: string;
  brandRight: string;
}

export default function Footer({ dealCode, brandLeft, brandRight }: Props) {
  return (
    <footer className="ic-footer">
      <div>END · {dealCode} · IC PACKAGE</div>
      <div className="ic-footer-right">
        {brandLeft}
        <br />
        {brandRight}
      </div>
    </footer>
  );
}

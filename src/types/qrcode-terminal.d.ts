declare module 'qrcode-terminal' {
  interface Options {
    small?: boolean;
    scale?: number;
    margin?: number;
  }

  function generate(text: string, options?: Options, cb?: (qrcode: string) => void): void;

  const qrcode: {
    generate: typeof generate;
  };

  export default qrcode;
}

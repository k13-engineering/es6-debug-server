type TCodeReplacement = {
  replacement: string;
  range: {
    from: number;
    to: number;
  };
};

const createCodeReplacer = () => {

  const replaceCode = ({ code, replacements }: { code: string, replacements: TCodeReplacement[] }): string => {
    // eslint-disable-next-line fp/no-mutating-methods
    const replacementsLastToFirst = replacements.slice().sort((a, b) => {
      return b.range.from - a.range.from;
    });

    let result = code;

    replacementsLastToFirst.forEach((replacement) => {
      const { from, to } = replacement.range;
      const before = result.substring(0, from);
      const after = result.substring(to);
      result = `${before}${replacement.replacement}${after}`;
    });

    return result;
  };

  return {
    replaceCode
  };
};

export {
  createCodeReplacer
};

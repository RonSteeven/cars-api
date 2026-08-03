import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { XmlParseError } from '@/shared/errors.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

export const parseXml = (xml: string, source: string): unknown => {
  if (xml.trim().length === 0) {
    throw new XmlParseError(`Empty XML document received from ${source}`, {
      context: { source },
    });
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new XmlParseError(`Malformed XML received from ${source}: ${validation.err.msg}`, {
      context: {
        source,
        line: validation.err.line,
        column: validation.err.col,
        code: validation.err.code,
      },
    });
  }

  try {
    return parser.parse(xml) as unknown;
  } catch (cause) {
    throw new XmlParseError(
      `Failed to parse XML from ${source}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause, context: { source } },
    );
  }
};

// @flow

import 'babel-polyfill';
import * as React from 'react';
import ReactDom from 'react-dom';

type Props = {
  name: string
};

type State = {
  count: number
};

class HelloMessage extends React.Component<Props, State> {
  static defaultProps = {
    name: "Unknown Person"
  };
  state = {
    count: 0
  };
  componentDidMount () {
    setInterval(() => {
      super.setState({
        ...this.state,
        count: this.state.count + 1
      });
    }, 1000);
  }
  render () {
    return <div>Hello {this.props.name} and count: {this.state.count}</div>;
  }
}

const root = document.getElementById('root');

if (root) {
  ReactDom.render(<HelloMessage name="Roger" />, root);
} else {
  throw new Error('No Root Element');
}
